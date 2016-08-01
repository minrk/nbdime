// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// This code is based on the CodeMirror mergeview.js source:
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

'use strict';


import {
  IDiffEntry, IDiffPatch
} from './diffutil';


export interface IMergeDecision {
  local_diff?: IDiffEntry[];
  remote_diff?: IDiffEntry[];

  conflict?: boolean;

  action?: string;

  common_path?: string;

  custom_diff?: IDiffEntry[];
}



function popPath(diffs: IDiffEntry[][]): {diffs: IDiffEntry[][], key: string} {
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
    console.log("Empty merge decision (no diffs)!");
    return null;
  }

  // Check if ops and keys are equal for all non-null diffs
  let op = diffs[i][0].op;
  let key = diffs[i][0].key;
  for (let di of diffs) {
    if (di && di.length > 0) {
      // Note that while diff lists can have 2 entries, they should never cause
      // a pop, as they will ahve a difference in op.
      for (let dj of di) {
        if (dj.op !== op || dj.key !== key) {
          return null;
        }
      }
    }
  }
  // Inspect patch op further along:
  if (op == "patch") {
    // Only pop if sub-diff has length 1
    for (let di of diffs) {
      if (di && (di.length !== 1 || (di[0] as IDiffPatch).diff.length !== 1)) {
        return null;
      }
    }
    let retDiffs = []
    for (let di of diffs) {
      // Note: Assumes check of length === 1 above:
      retDiffs.push((di[0] as IDiffPatch).diff)
    }
    return {diffs: retDiffs, key: key.toString()};
  }
  return null;
}

/**
 * Expand the `common_path` field of the merge decisions for optimized
 * processing. Modifies the merge decisions in-place.
 */
export function resolveCommonPaths(decisions: IMergeDecision[]) {
  for (let md of decisions) {
    let diffs = [md.local_diff, md.remote_diff];
    if (md.action === "custom") {
      diffs.push(md.custom_diff);
    }
    let path = md.common_path || "/";
    let popped: {diffs: IDiffEntry[][], key: string} = null;
    while (popped = popPath(diffs)) {
      path += "/" + popped.key;
      diffs = popped.diffs;
    }
    md.common_path = path;
  }
  return dec;
}
