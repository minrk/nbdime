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
  // Find first non-null diff:
  let i = 0;
  for (let di of diffs) {
    if (di !== null) {
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
  let op = diffs[i].op;
  let key = diffs[i].key;
  for (let di of diffs) {
    if (di && (di.op !== op || di.key !== key)) {
      return null;
    }
  }
  // Inspect patch op further along:
  if (op == "patch") {
    // Only go further in if sub-diff has length 1
    for (let di of diffs) {
      if (di && (di as IDiffPatch).diff.length !== 1) {
        return null;
      }
    }
    let retDiffs = []
    for (let di of diffs) {
      retDiffs = retDiffs.concat((di as IDiffPatch).diff)
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
      diffs = diffs.concat(md.custom_diff);
    }
    let path = md.common_path || "/";
    let popped: {diffs: IDiffEntry[][], key: string} = null;
    while (popped = popPath(diffs)) {
      path += "/" + popped.key;
      diffs = popped.diffs;
    }
    md.common_path = path;
  }
}
