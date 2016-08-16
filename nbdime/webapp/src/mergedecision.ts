// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// This code is based on the CodeMirror mergeview.js source:
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

'use strict';


import {
  IDiffEntry, IDiffPatch, opRemove, opReplace, opRemoveRange, opPatch,
} from './diffutil';

import {
  patch
} from './patch';

import {
  shallowCopy, deepCopy, valueIn, isPrefixArray, findSharedPrefix
} from './util';

export
type DecisionPath = (string | number)[];

export
type ChunkSource = {
  decision: IMergeDecision;
  action: 'local' | 'remote' | 'either' | 'custom' | 'mixed';
};

export
interface IMergeDecision {
  local_diff?: IDiffEntry[];
  remote_diff?: IDiffEntry[];

  conflict?: boolean;

  action?: string;

  common_path?: DecisionPath;

  custom_diff?: IDiffEntry[];
}


export
function popPath(diffs: IDiffEntry[][], popInner?: boolean): {
      diffs: IDiffEntry[][], key: string | number} {
  if (diffs.length < 1) {
    return null;
  }
  // Find first non-null, non-empty diff list:
  let i = 0, j = 0;
  for (let di of diffs) {
    if (di !== null && di.length > 0) {
      break;
    }
    i++;
  }
  // Assert that we have at least one non-null diff:
  if (i === diffs.length) {
    console.log('Empty merge decision (no diffs)!');
    return null;
  }

  // Check if ops and keys are equal for all non-null diffs
  let op = diffs[i][0].op;
  let key = diffs[i][0].key;
  for (let di of diffs) {
    if (di && di.length > 0) {
      // Note that while diff lists can have 2 entries, they should never cause
      // a pop, as they will have a difference in op.
      for (let dj of di) {
        if (dj.op !== op || dj.key !== key) {
          return null;
        }
      }
    }
  }
  // Inspect patch op further along:
  if (op === 'patch') {
    // Only pop if sub-diff has length 1 (unless popInner is true)
    if (popInner !== true) {
      for (let di of diffs) {
        if (di && di.length > 0 && (di.length !== 1 ||
            (di[0] as IDiffPatch).diff.length !== 1)) {
          return null;
        }
      }
    }
    let retDiffs = [];
    for (let di of diffs) {
      if (di && di.length > 0) {
        retDiffs.push((di[0] as IDiffPatch).diff);
      } else {
        retDiffs.push(null);
      }
    }
    return {diffs: retDiffs, key: key};
  }
  return null;
}

function pushPath(diffs: IDiffEntry[], prefix: DecisionPath): IDiffEntry[] {
  for (let key of prefix.reverse()) {
    diffs = [opPatch(key, diffs)];
  }
  return diffs;
}

/**
 * Expand the `common_path` field of the merge decisions for optimized
 * processing. Modifies the merge decisions in-place.
 */
export
function resolveCommonPaths(decisions: IMergeDecision[]) {
  for (let md of decisions) {
    let diffs = [md.local_diff, md.remote_diff];
    if (md.action === 'custom') {
      diffs.push(md.custom_diff);
    }
    let path = md.common_path.slice() || [];
    let popped: {diffs: IDiffEntry[][], key: string | number} = null;
    while (popped = popPath(diffs)) {
      path.push(popped.key);
      diffs = popped.diffs;
    }
    md.common_path = path;
    md.local_diff = diffs[0];
    md.remote_diff = diffs[1];
  }
}

/**
 * Make a new 'cleared' value of the right type.
 */
function makeClearedValue(value: any): any {
    if (value instanceof Array) {
        // Clearing e.g. an outputs list means setting it to an empty array
        return [];
    } else if (value instanceof Object) {
        // Clearing e.g. a metadata dict means setting it to an empty Object
        return {};
    } else if (typeof(value) === 'string') {
        // Clearing e.g. a source string means setting it to an empty string
        return '';
    } else {
        // Clearing anything else (atomic values) means setting it to null
        return null;
    }
}


function _getSubObject(obj: any, path: DecisionPath) {
  for (let key of path) {
    obj = obj[key];   // Should throw if key missing
  }
  return obj;
}


function resolveAction(base: any, decision: IMergeDecision): IDiffEntry[] {
    let a = decision.action;
    if (a === 'base') {
        return [];   // no-op
    } else if (valueIn(a, ['local', 'either'])) {
        return decision.local_diff.slice();
    } else if (a === 'remote') {
        return decision.remote_diff.slice();
    } else if (a === 'custom') {
        return decision.custom_diff.slice();
    } else if (a === 'local_then_remote') {
        return decision.local_diff.concat(decision.remote_diff);
    } else if (a === 'remote_then_local') {
        return decision.remote_diff.concat(decision.local_diff);
    } else if (a === 'clear') {
        let key = null;
        for (let d of decision.local_diff.concat(decision.remote_diff)) {
            if (key) {
                console.assert(key === d.key);
            } else {
                key = d.key;
            }
        }
        return [opReplace(key, makeClearedValue(base[key]))];
    } else if (a === 'clear_parent') {
        if (typeof(base) === typeof([])) {
            return [opRemoveRange(0, base.length)];
        } else {
            // Ideally we would do a opReplace on the parent, but this is not
            // easily combined with this method, so simply remove all keys
            let diff: IDiffEntry[] = [];
            for (let key of base) {
              diff.push(opRemove(key));
            }
            return diff;
        }
    } else {
        throw 'The action \"' + a + '\" is not defined';
    }
}


export
function applyDecisions(base: any, decisions: IMergeDecision[]): any {
  let merged = deepCopy(base);
  let prevPath: DecisionPath = null;
  let parent: any = null;
  let lastKey: string | number = null;
  let resolved: any = null;
  let diffs: IDiffEntry[] = null;
  // clear_parent actions should override other decisions on same obj, so
  // we need to track it
  let clearParent: boolean = false;
  for (let md of decisions) {
    let path = md.common_path.slice();
    // We patch all decisions with the same path in one op
    if (path == prevPath) {
      if (clearParent) {
        // Another entry will clear the parent, so all other decisions
        // should be dropped
      } else {
        if (md.action == 'clear_parent') {
          clearParent = true;
          diffs = [];  // Clear any exisiting decsions!
        }
        diffs = diffs.concat(resolveAction(resolved, md));
      }
    } else {
      // Different path, start a new collection
      if (prevPath !== null) {
        // First, apply previous diffs
        if (parent === null) {
          // Operations on root create new merged object
          merged = patch(resolved, diffs);
        } else {
          // If not, overwrite entry in parent (which is an entry in merged).
          // This is ok, as no paths should point to subobjects of the patched
          // object.
          parent[lastKey] = patch(resolved, diffs);
        }
      }

      prevPath = path.slice();
      // Resolve path in base and output
      resolved = merged;
      parent = null;
      lastKey = null;
      for (let key of path) {
        parent = resolved;
        resolved = resolved[key];   // Should throw if key missing
        lastKey = key;
      }
      diffs = resolveAction(resolved, md);
      clearParent = md.action === 'clear_parent';
    }
  }

  // Apply the last collection of diffs, if present (same as above)
  if (prevPath !== null) {
    if (parent === null) {
      merged = patch(resolved, diffs);
    } else {
      parent[lastKey] = patch(resolved, diffs);
    }
  }
  return merged;
}




/**
 * Label a set of diffs with a source, recursively.
 */
export
function labelSource(diff: IDiffEntry[], source: ChunkSource): IDiffEntry[] {
  if (diff) {
    for (let d of diff) {
      d.source = source;
      if ((d as IDiffPatch).diff !== undefined) {
        labelSource((d as IDiffPatch).diff, source);
      }
    }
  }
  return diff;
}


type DiffTree = {[prefix: string]: {'path': DecisionPath, 'diff': IDiffEntry[]}};

/**
 * Merge a tree of diffs at varying path levels to one diff at their shared root
 *
 * Relies on the format specification about decision ordering to help
 * simplify the process (deeper paths should come before its parent paths).
 * This is realized by the `sortedPaths` argument.
 */
function _mergeTree(tree: DiffTree, sortedPaths: string[]): IDiffEntry[] {
  let trunk: IDiffEntry[] = [];
  let root: DecisionPath = null;
  for (let i = 0; i < sortedPaths.length; ++i) {
    let pathStr = sortedPaths[i];
    let path = tree[pathStr].path;
    let nextPath: DecisionPath = null;
    if (i === sortedPaths.length - 1) {
      nextPath = root;
    } else {
      let nextPathStr = sortedPaths[i + 1];
      nextPath = tree[nextPathStr].path;
    }
    let subdiffs = tree[pathStr].diff;
    // First, check if path is subpath of nextPath:
    if (isPrefixArray(nextPath, path)) {
      // We can simply promote existing diffs to next path
      trunk = trunk.concat(subdiffs);
      if (nextPath) {
        trunk = pushPath(trunk, path.slice(nextPath.length));
        root = nextPath;
      }
    } else {
      // We have started on a new trunk
      // Collect branches on the new trunk, and merge the trunks
      let newTrunk = _mergeTree(tree, sortedPaths.slice(i + 1));
      let prefix = findSharedPrefix(path, nextPath);
      let pl = prefix.length;
      trunk = pushPath(trunk, path.slice(pl)).concat(
        pushPath(newTrunk, nextPath.slice(pl)));
      break;  // Recursion will exhaust sortedPaths
    }
  }
  return trunk;
}


/**
 * Builds a diff for direct application on base. The `which` argument either
 * selects the 'local', 'remote' or 'merged' diffs.
 *
 * By supplying `stripPath`, a given number of paths can be removed from the
 * decisions common_path before applying.
 */
export
function buildDiffs(base: any, decisions: IMergeDecision[], which: string,
                    stripPath?: number): IDiffEntry[] {
  let tree: DiffTree = {};
  let sortedPaths = [];
  let local = which === 'local';
  let merged = which === 'merged';
  stripPath = stripPath || 0;
  if (!local && !merged) {
    console.assert(which === 'remote');
  }
  for (let md of decisions) {
    let subdiffs: IDiffEntry[] = null;
    let path = md.common_path.slice(stripPath);
    if (merged) {
      let sub = _getSubObject(base, path);
      subdiffs = resolveAction(sub, md);
    } else {
      subdiffs = local ? md.local_diff : md.remote_diff;
      if (subdiffs === null) {
        subdiffs = [];
      }
    }
    let strPath = '/' + path.join('/');
    if (tree.hasOwnProperty(strPath)) {
      // Existing tree entry, simply add diffs to it
      tree[strPath].diff = tree[strPath].diff.concat(subdiffs);
    } else {
      // Make new entry in tree
      tree[strPath] = {'diff': subdiffs, 'path': path};
      sortedPaths.push(strPath);
    }
  }
  if (!tree.hasOwnProperty('/')) {
    tree['/'] = {'diff': [], 'path': []};
    sortedPaths.push('/');
  }

  // Tree is constructed, now join all branches at diverging points (joints)
  return _mergeTree(tree, sortedPaths);
}


/**
 * Move a path prefix in a merge decision from `common_path` to the diffs.
 *
 * This is done by wrapping the diffs in nested patch ops.
 */
export
function pushPatchDecision(decision: IMergeDecision, prefix: DecisionPath): IMergeDecision {
  let dec = shallowCopy(decision);
  // We need to start with inner most key to nest correctly, so reverse:
  for (let key of prefix.slice().reverse()) {
    if (dec.common_path.length === 0) {
      throw 'Cannot remove key from empty decision path: ' + key + ', ' + dec;
    }
    console.assert(dec.common_path[dec.common_path.length - 1] === key);
    dec.common_path = dec.common_path.slice(0, -1);  // pop key
    dec.local_diff = [opPatch(key, dec.local_diff)];
    dec.remote_diff = [opPatch(key, dec.remote_diff)];
    if (dec.action === 'custom') {
      dec.custom_diff = [opPatch(key, dec.custom_diff)];
    }
  }
  return dec;
}

export
function filterDecisions(decisions: IMergeDecision[], path: DecisionPath) {
  let ret: IMergeDecision[] = [];
  for (let md of decisions) {
    if (isPrefixArray(path, md.common_path)) {
      ret.push(md);
    }
  }
  return ret;
}
