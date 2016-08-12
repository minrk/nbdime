// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  IDiffAddRange, IDiffPatch, IDiffRemoveRange, DiffOp
} from './diffutil';

import {
  CellDiffModel, createAddedCellDiffModel,
  createDeletedCellDiffModel, createPatchedCellDiffModel
} from './diffmodel';

import {
  IMergeDecision, resolveCommonPaths, buildDiffs, pushPatchDecision
} from './mergedecision';

import {
  stringify
} from './patch';

import {
  arraysEqual, valueIn
} from './util';


/**
 * CellMergeModel
 */
export class CellMergeModel {
  constructor(base: nbformat.ICell, decisions: IMergeDecision[], mimetype: string) {
    this.base = base;
    this.mimetype = mimetype;
    this.cellLevel = false;

    // First check for cell-level decisions:
    if (decisions.length === 1 &&
        arraysEqual(decisions[0].common_path, ['cells'])) {
      // We have a cell level decision
      let md = decisions[0];
      decisions = this._applyCellDecision(md);
    }
    this.decisions = [];
    for (let md of decisions) {
      // Strip "/cells/*" from path, to make it relative to cell
      md.common_path = md.common_path.slice(2);
      this.decisions.push(md);
    }
  }

  /**
   * Base value of the cell
   */
  base: nbformat.ICell;

  /**
   * The mimetype to use for the source
   */
  mimetype: string;

  /**
   * Whether the cell is present in only one of the two side (local/remote)
   */
  cellLevel: boolean;

  /**
   * Run time flag whether the user wants to delete the cell or not
   */
  deleteCell: boolean;

  /**
   * Model of the local diff vs. base
   */
  get local(): CellDiffModel {
    if (this._local === undefined) {
      // We're builiding from decisions
      let diff = buildDiffs(this.base, this.decisions, 'local');
      this._local = createPatchedCellDiffModel(this.base, diff, this.mimetype);
    }
    return this._local;
  }

  /**
   * Model of the remote diff vs. base
   */
  get remote(): CellDiffModel {
    if (this._remote === undefined) {
      let diff = buildDiffs(this.base, this.decisions, 'remote');
      this._remote = createPatchedCellDiffModel(this.base, diff, this.mimetype);
    }
    return this._remote;
  }

  /**
   * Model of the diff of the merged cell vs. base
   */
  get merged(): CellDiffModel {
    if (this._merged === undefined) {
      let diff = buildDiffs(this.base, this.decisions, 'merged');
      this._merged = createPatchedCellDiffModel(this.base, diff, this.mimetype);
    }
    return this._merged;
  }

  /**
   *
   */
  get subModels(): CellDiffModel[] {
    return [this.local, this.remote, this.merged];
  }

  /**
   * The merge decisions that apply to this cell
   */
  decisions: IMergeDecision[];

  /**
   *
   */
  diffSourceLUT: {[id: string]: string; };

  /**
   *
   */
  addDecision(decision: IMergeDecision) {
    // Don't allow patching if we've already made models
    console.assert(!this._local && !this._remote && !this._merged);

    if (arraysEqual(decision.common_path, ['cells'])) {
      this._applyCellDecision(decision);
    } else {
      decision.common_path = decision.common_path.slice(2);
      this.decisions.push(decision);
    }
  }

  protected splitPatch(md: IMergeDecision, patch: IDiffPatch, local: boolean): IMergeDecision[] {
    // Split patch on source, metadata and outputs, and make new decisions
    let diff = patch.diff;
    let out: IMergeDecision[] = [];
    for (let d of diff) {
      if (!valueIn(d.key, ['source', 'metadata', 'outputs'])) {
        throw 'Currently not able to handle conflicts on cell variable \"' +
              d.key + '\"';
      }
      out.push({
        'common_path': md.common_path.slice(),
        'conflict': md.conflict,
        'action': md.action,
        'local_diff': local ? [d] : null,
        'remote_diff': local ? null : [d],
      });
    }
    return out;
  }

  protected _applyCellDecision(md: IMergeDecision): IMergeDecision[] {
    let newDecisions = [];
    /* Possibilities:
     1. Insertion: base is null! Null diff of missing side (unchanged).
     2. Deletion: Null diff of present side (unchanged). Set deleteCell
        depending on action.
     3. Deletion vs patch: Same as 2., but split patch decision onto
        source/metadata/outputs.
     4. Identical ops (insertion or deletion)
     Cases that shouldn't happen:
     5. Insertion vs insertion: Shouldn't happen! Caller should split into
        two decisions with an insertion each
     6. Patch vs patch: Shouldn't occur, as those should have been recursed
     */
    console.assert(!this.cellLevel,
                   'Cannot have multiple cell decisions on one cell!');
    this.cellLevel = true;  // We set this to distinguish case 3 from normal
    let ld = md.local_diff !== null && md.local_diff.length !== 0;
    let rd = md.remote_diff !== null && md.remote_diff.length !== 0;
    if (!ld) {
      // 1. or 2.:
      this._local = null;
      console.assert(md.remote_diff.length === 1);
      if (this.base === null) {
        // 1.
        console.assert(md.remote_diff[0].op === DiffOp.SEQINSERT);
        let v = (md.remote_diff[0] as IDiffAddRange).valuelist[0];
        this._remote = createAddedCellDiffModel(v, this.mimetype);
        this._merged = createAddedCellDiffModel(v, this.mimetype);
      } else {
        // 2.
        this._remote = createDeletedCellDiffModel(this.base, this.mimetype);
        this._merged = createDeletedCellDiffModel(this.base, this.mimetype);
        this.deleteCell = valueIn(md.action, ['remote', 'either']);
      }
    } else if (!rd) {
      // 1. or 2.:
      this._remote = null;
      console.assert(md.local_diff.length === 1);
      if (this.base === null) {
        // 1.
        console.assert(md.local_diff[0].op === DiffOp.SEQINSERT);
        let v = (md.local_diff[0] as IDiffAddRange).valuelist[0];
        this._local = createAddedCellDiffModel(v, this.mimetype);
        this._merged = createAddedCellDiffModel(v, this.mimetype);
      } else {
        // 2.
        this._local = createDeletedCellDiffModel(this.base, this.mimetype);
        this._merged = createDeletedCellDiffModel(this.base, this.mimetype);
        this.deleteCell = valueIn(md.action, ['local', 'either']);
      }
    } else {
      console.assert(ld && rd);
      console.assert(md.local_diff.length === 1 && md.remote_diff.length === 1);
      // 3. or 4.
      if (md.local_diff[0].op === md.remote_diff[0].op) {
        // 4.
        if (this.base === null) {
          // Identical insertions (this relies on preprocessing to ensure only
          // one value in valuelist)
          let v = (md.local_diff[0] as IDiffAddRange).valuelist[0];
          this._local = createAddedCellDiffModel(v, this.mimetype);
          this._remote = createAddedCellDiffModel(v, this.mimetype);
          this._merged = createAddedCellDiffModel(v, this.mimetype);
        } else {
          // Identical delections
          this._local = createDeletedCellDiffModel(this.base, this.mimetype);
          this._remote = createDeletedCellDiffModel(this.base, this.mimetype);
          this._merged = createDeletedCellDiffModel(this.base, this.mimetype);
        }
      } else {
        // 3., by method of elimination
        let ops = [md.local_diff[0].op, md.remote_diff[0].op];
        console.assert(
          valueIn(DiffOp.SEQDELETE, ops) && valueIn(DiffOp.PATCH, ops));
        if (ops[0] === DiffOp.REMOVE) {
          this._local = createDeletedCellDiffModel(this.base, this.mimetype);
          this.deleteCell = md.action === 'local';
          newDecisions = newDecisions.concat(this.splitPatch(
            md, md.remote_diff[0] as IDiffPatch, true));
        } else {
          this._remote = createDeletedCellDiffModel(this.base, this.mimetype);
          this.deleteCell = md.action === 'remote';
          newDecisions = newDecisions.concat(this.splitPatch(
            md, md.local_diff[0] as IDiffPatch, false));
        }
      }
    }
    return newDecisions;
  }

  protected _local: CellDiffModel;
  protected _remote: CellDiffModel;
  protected _merged: CellDiffModel;
}


/**
 * The merge format allows for chunking of sequence diffs such that one entry
 * in the diff lists have 2 entries, where the first is always an insertion
 * (addrange). For cells, we split these decisions in two, for easier
 * visualization.
 */
function splitCellChunks(mergeDecisions: IMergeDecision[]): IMergeDecision[] {
  let output: IMergeDecision[] = [];
  for (let md of mergeDecisions) {
    if (md.local_diff && md.local_diff.length === 2) {
      // Split off local
      output.push({
        'common_path': md.common_path.slice(),
        'local_diff': md.local_diff.slice(0, 1),
        'remote_diff': [],
        'action': 'local', // Check for custom action first?
        'conflict': md.conflict,
        'custom_diff': null
      });
      output.push({
        'common_path': md.common_path.slice(),
        'local_diff': md.local_diff.slice(1),
        'remote_diff': md.remote_diff,
        'action': md.action,
        'conflict': md.conflict,
        'custom_diff': md.custom_diff
      });
    } else if (md.remote_diff && md.remote_diff.length === 2) {
      // Split off remote
      output.push({
        'common_path': md.common_path.slice(),
        'local_diff': [],
        'remote_diff': md.remote_diff.slice(0, 1),
        'action': 'remote', // Check for custom action first?
        'conflict': md.conflict,
        'custom_diff': null
      });
      output.push({
        'common_path': md.common_path.slice(),
        'local_diff': md.local_diff,
        'remote_diff': md.remote_diff.slice(1),
        'action': md.action,
        'conflict': md.conflict,
        'custom_diff': md.custom_diff
      });
    } else {
      output.push(md);  // deepCopy?
    }
  }
  resolveCommonPaths(output);
  return output;
}


/**
 * Split "removerange" diffs on cell list level into individual decisions!
 */
function splitCellRemovals(mergeDecisions: IMergeDecision[]): IMergeDecision[] {
  let output: IMergeDecision[] = [];

  let makeSplitPart = function(md: IMergeDecision, key: number,
                               local: boolean, remote: boolean) {
    let newMd: IMergeDecision = {
      'common_path': md.common_path.slice(),
      'conflict': md.conflict,
      'action': md.action  // assert action in ["remote", "base"]?
    };
    let newDiff = [{
        'key': key,
        'op': DiffOp.SEQDELETE,
        'length': 1
    }];
    console.assert(local || remote);
    newMd.local_diff = local ? newDiff : null;
    newMd.remote_diff = remote ? newDiff : null;
    return newMd;
  };

  for (let md of mergeDecisions) {
    if (!arraysEqual(md.common_path, ['cells'])) {
      output.push(md);
      continue;
    }

    let dl = md.local_diff && md.local_diff.length > 0 ? md.local_diff[md.local_diff.length - 1] : null;
    let dr = md.remote_diff && md.remote_diff.length > 0 ? md.remote_diff[md.remote_diff.length - 1] : null;
    // TODO: Does it make sense to split on custom?

    if (dl && !dr || dr && !dl) {
      // One-way diff
      let d = dl ? dl : dr;

      if (d.op === DiffOp.SEQDELETE && (d as IDiffRemoveRange).length > 1) {
        // Found a one-way diff to split!
        for (let i = 0; i < (d as IDiffRemoveRange).length; ++i) {
          output.push(makeSplitPart(md, (d.key as number) + i, !!dl, !!dr));
        }
      } else {
        // Not a removerange type:
        output.push(md);
        continue;
      }
    } else if (dr && dl) {
      // Two way diff, keys need to be matched
      if (dl.op !== DiffOp.SEQDELETE && dr.op !== DiffOp.SEQDELETE) {
        // Not a removerange type:
        output.push(md);
        continue;
      } else if (dl.op === dr.op) {
        // Both sides have removerange, just match keys/length
        // Note: Assume that ranges have overlap, since they are in one decision
        let klStart = dl.key as number;
        let krStart = dr.key as number;
        let start = Math.min(klStart, krStart);
        let klEnd = klStart + (dl as IDiffRemoveRange).length;
        let krEnd = krStart + (dr as IDiffRemoveRange).length;
        let end = Math.max(klEnd, krEnd);
        for (let i = start; i < end; ++i) {
          let local = i >= klStart && i < klEnd;
          let remote = i >= krStart && i < krEnd;
          output.push(makeSplitPart(md, i, local, remote));
        }
      } else {
        // One side has removerange, the other a patch op (implied)
        let remLocal = dl.op === DiffOp.SEQDELETE;
        let rOp = (remLocal ? dl : dr) as IDiffRemoveRange;
        let pOp = (remLocal ? dr : dl) as IDiffPatch;
        console.assert(pOp.op === DiffOp.PATCH);

        let pidx = pOp.key as number;
        let start = rOp.key as number;
        for (let i = start; i < start + rOp.length; ++i) {
          let newMd = makeSplitPart(md, i, remLocal, !remLocal);
          if (i === pidx) {
            if (remLocal) {
              newMd.remote_diff = [pOp];
            } else  {
              newMd.local_diff = [pOp];
            }
          }
          output.push(newMd);
        }
      }
    }
  }
  return output;
}


/**
 * Split "addrange" diffs on cell list level into individual decisions!
 * Also splits two-way insertions into two individual ones.
 */
function splitCellInsertions(mergeDecisions: IMergeDecision[]): IMergeDecision[] {
  // TODO: Implement!
  let output: IMergeDecision[] = [];

  let makeSplitPart = function(md: IMergeDecision, value: any,
                               local: boolean, remote: boolean) {
    let newMd: IMergeDecision = {
      'common_path': md.common_path.slice(),
      'conflict': md.conflict,
      'action': md.action  // assert action value?
    };
    let key = (local ? md.local_diff : md.remote_diff)[0].key;
    let newDiff = [{
        'key': key,
        'op': DiffOp.SEQINSERT,
        'valuelist': [value]
    }];

    console.assert(local || remote);
    newMd.local_diff = local ? newDiff : null;
    newMd.remote_diff = remote ? newDiff : null;
    return newMd;
  };

  for (let md of mergeDecisions) {
    // Just push decisions not on cells list:
    if (!arraysEqual(md.common_path, ['cells'])) {
      output.push(md);
      continue;
    }

    // Check wether all diffs are pure addrange
    let correctType = true;
    for (let dl of md.local_diff) {
      if (dl.op !== DiffOp.SEQINSERT) {
        correctType = false;
        break;
      }
    }
    for (let dl of md.remote_diff) {
      if (dl.op !== DiffOp.SEQINSERT) {
        correctType = false;
        break;
      }
    }
    if (!correctType) {
      output.push(md);
      continue;
    }

    let dl = md.local_diff && md.local_diff.length === 1 ? md.local_diff[0]  as IDiffAddRange : null;
    let dr = md.remote_diff && md.remote_diff.length === 1 ? md.remote_diff[0] as IDiffAddRange : null;

    if (dl && !dr || dr && !dl) {
      // One-way diff
      let d = dl ? md.local_diff[0] : md.remote_diff[0];
      let insert = (d as IDiffAddRange).valuelist;
      for (let v of insert) {
        output.push(makeSplitPart(md, v, !!dl, !!dr));
      }
    } else if (dl && dr) {
      // Two way diff
      // First, check if both insertions are equal!
      let eq = stringify(dl.valuelist) === stringify(dr.valuelist);
      if (eq) {
        // Split to one decision per cell
        for (let c of dl.valuelist) {
          output.push(makeSplitPart(md, c, true, true));
        }
      } else {
        // Next, check decision for ruling on order (e.g.
        // local_then_remote, which we will use as the default).

        let start = dl.key as number;
        console.assert(start === dr.key);
        if (md.action === 'remote_then_local') {
          // Only case where we need to switch order!
          for (let c of dr.valuelist as any[]) {
            output.push(makeSplitPart(md, c, false, true));
          }
          for (let c of dl.valuelist as any[]) {
            output.push(makeSplitPart(md, c, true, false));
          }
        } else {
          for (let c of dl.valuelist as any[]) {
            output.push(makeSplitPart(md, c, true, false));
          }
          for (let c of dr.valuelist as any[]) {
            output.push(makeSplitPart(md, c, true, false));
          }
        }
      }

    }
  }
  return output;
}


/**
 * Diff model for a Jupyter Notebook
 */
export
class NotebookMergeModel {

  /**
   * Create a new NotebookDiffModel from a base notebook and a list of diffs.
   *
   * The base as well as the diff entries are normally supplied by the nbdime
   * server.
   */
  constructor(base: nbformat.INotebookContent,
              mergeDecisions: IMergeDecision[]) {
    this.base = base;
    let ctor = this.constructor as typeof NotebookMergeModel;
    this.mergeDecisions = ctor.preprocessDecisions(mergeDecisions);
    this.cells = this.buildCellList();

    // The notebook metadata MIME type is used for determining the MIME type
    // of source cells, so store it easily accessible:
    try {
      this.mimetype = base.metadata.language_info.mimetype;
    } catch (e) {
      // missing metadata, guess python (probably old notebook)
      this.mimetype = 'text/python';
    }
  }

  static preprocessDecisions(mergeDecisions: IMergeDecision[]): IMergeDecision[] {
    mergeDecisions = splitCellChunks(mergeDecisions);
    mergeDecisions = splitCellRemovals(mergeDecisions);
    mergeDecisions = splitCellInsertions(mergeDecisions);
    resolveCommonPaths(mergeDecisions);
    return mergeDecisions;
  }

  /**
   * Base notebook of the merge
   */
  base: nbformat.INotebookContent;

  /**
   * List of merge decisions defining local, remote and merge output in its
   * entirety, given the base.
   */
  mergeDecisions: IMergeDecision[];

  /**
   * List off individual cell merges
   */
  cells: CellMergeModel[];

  /**
   * The default MIME type according to the notebook's root metadata
   */
  mimetype: string;

  /**
   * Correlate the different cells in the diff lists into a merge list
   */
  protected buildCellList(): CellMergeModel[] {
    // We have to check for merge decisions on the `cells` object in
    // order to check for added cells. This assumes that the common
    // paths of the merge decisions have been resolved. It also assumes that
    // no merge decision can have root as its common path.

    let cells: CellMergeModel[] = [];

    // Simply create unchanged cells first, then we will modify as neccessary
    // below.
    for (let bc of this.base.cells) {
      cells.push(new CellMergeModel(bc, [], this.mimetype));
    }

    let insertOffset = 0;
    // Assumes merge decisions come in order!
    for (let md of this.mergeDecisions) {
      let key = md.common_path;
      if (key.length < 1 || key[0] !== 'cells') {
        continue;   // Only care about decisions on cells here
      }

      if (arraysEqual(key, ['cells'])) {
        let idx: number = null;
        let insertion = false;
        for (let di of [md.local_diff, md.remote_diff]) {
          // Ensure diff has exactly one item:
          if (!di || di.length === 0) {
            continue;
          }
          // All keys should be the same since we run splitCellChunks first
          idx = (di[0].key as number);
          if (di[0].op === DiffOp.SEQINSERT) {
            // Rely on preprocessing splitting to cell level!
            let insertedCell = new CellMergeModel(null, [md], this.mimetype);

            // Insert entries into `cells` at idx
            let offsetIdx = insertOffset + idx;
            cells.splice(offsetIdx, 0, insertedCell);
            insertOffset += 1;
            insertion = true;  // flag to break outer loop
            break;
          }
          // Only checking for insertions in this loop, since insertions can
          // only be paired with other insertions.
        }
        if (insertion) {
          continue;
        }
        // If we reach this point, it is not an insertion merge!
        if (idx === null) {
          throw 'No index could be found for merge decision!';
        }
        let c = cells[idx + insertOffset];
        c.addDecision(md);
      } else {
        // Has a path into a cell
        // Format specifies that these always comes before decisions that
        // change the order of cells, so index is straight forward!
        let idx = key[1];
        let c = cells[idx];
        c.addDecision(md);
      }
    }

    return cells;
  }
}
