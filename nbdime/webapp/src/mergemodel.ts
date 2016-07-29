// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  IDiffEntry, IDiffAddRange, IDiffPatch, IDiffRemoveRange, getDiffKey, DiffOp
} from './diffutil';

import {
  NotebookDiffModel, CellDiffModel, IStringDiffModel,
  createUnchangedCellDiffModel, createAddedCellDiffModel,
  createDeletedCellDiffModel, createPatchedCellDiffModel
} from './diffmodel';

import {
  IMergeDecision, resolveCommonPaths
} from './mergedecisions';

import {
  deepCopy
} from './util';


/**
 * CellMergeModel
 */
export class CellMergeModel {
  constructor(localDiff: CellDiffModel,
        remoteDiff: CellDiffModel,
        mergedDiff: CellDiffModel) {
    this.local = localDiff;
    this.remote = remoteDiff;
    this.merged = mergedDiff;
  }

  /**
   * Model of the local diff vs. base
   */
  local: CellDiffModel;

  /**
   * Model of the remote diff vs. base
   */
  remote: CellDiffModel;

  /**
   * Model of the diff of the merged cell vs. base
   */
  merged: CellDiffModel;

  /**
   *
   */
  get subModels(): CellDiffModel[] {
    return [this.local, this.remote, this.merged];
  }
}


function createUnchangedCellMergeModel(base: nbformat.ICell, nbMimetype: string): CellMergeModel {
  return new CellMergeModel(
    createUnchangedCellDiffModel(base, nbMimetype),
    createUnchangedCellDiffModel(base, nbMimetype),
    createUnchangedCellDiffModel(base, nbMimetype)
  )
}


/**
 * Create a merge model of a cell that has been inserted either locally,
 * remotely, or both, as specified by the mergeDecision.
 */
function createInsertedCellMergeModels(
      mergeDecision: IMergeDecision, nbMimetype: string): CellMergeModel[] {
  let local: CellDiffModel, remote: CellDiffModel, merged: CellDiffModel;
  let models: CellMergeModel[] = [];
  if (mergeDecision.local_diff && mergeDecision.remote_diff) {

  } else if (mergeDecision.local_diff) {
    let d = mergeDecision.local_diff[0] as IDiffAddRange;
    for (let di of d.valuelist) {
      let local_i = createAddedCellDiffModel(di, nbMimetype);
      let merged_i: CellDiffModel = null;
      switch (mergeDecision.action) {
        case "base":
        case "remote":
          merged_i = null;
          break;
        case "local":
        case "local_then_remote":
        case "remote_then_local":
        case "either":
          merged_i = createAddedCellDiffModel(di, nbMimetype);
          break;
        default:
          break;
      }
      models = models.concat([new CellMergeModel(local_i, null, merged_i)]);
    }
  } else if (mergeDecision.remote_diff) {
    let d = mergeDecision.remote_diff[0] as IDiffAddRange;
    for (let di of d.valuelist) {
      let local_i = createAddedCellDiffModel(di, nbMimetype);
      let merged_i: CellDiffModel = null;
      switch (mergeDecision.action) {
        case "base":
        case "local":
          merged_i = null;
          break;
        case "remote":
        case "local_then_remote":
        case "remote_then_local":
          merged_i = createAddedCellDiffModel(di, nbMimetype);
          break;
        default:
          break;
      }
      models = models.concat([new CellMergeModel(local_i, null, merged_i)]);
    }
  } else {
    throw "Invalid arguments to createInsertedCellMergeModel!"
  }
  return models;
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
    if (md.local_diff.length == 2) {
      // Split off local
      output = output.concat([{
        "common_path": md.common_path,
        "local_diff": md.local_diff.slice(0, 1),
        "remote_diff": [],
        "action": "local", // Check for custom action first?
        "conflict": md.conflict,
        "custom_diff": null
      }]);
      output = output.concat([{
        "common_path": md.common_path,
        "local_diff": md.local_diff.slice(1),
        "remote_diff": md.remote_diff,
        "action": md.action,
        "conflict": md.conflict,
        "custom_diff": md.custom_diff
      }]);
    } else if (md.remote_diff.length == 2) {
      // Split off remote
      output = output.concat([{
        "common_path": md.common_path,
        "local_diff": [],
        "remote_diff": md.remote_diff.slice(0, 1),
        "action": "remote", // Check for custom action first?
        "conflict": md.conflict,
        "custom_diff": null
      }]);
      output = output.concat([{
        "common_path": md.common_path,
        "local_diff": md.local_diff,
        "remote_diff": md.remote_diff.slice(1),
        "action": md.action,
        "conflict": md.conflict,
        "custom_diff": md.custom_diff
      }]);
    } else {
      output = output.concat([md]);  // deepCopy?
    }
  }
  return output;
}


/**
 * Split "removerange" diffs on cell level into individual decisions!
 */
function splitCellRemovals(mergeDecisions: IMergeDecision[]): IMergeDecision[] {
  // TODO: Implement!
}


function applyDecision(mergeDecision: IMergeDecision, base: nbformat.ICell): nbformat.ICell {
  // TODO: Implement
}


/**
 * Diff model for a Jupyter Notebook
 */
export class NotebookMergeModel {

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
    resolveCommonPaths(mergeDecisions);
    return mergeDecisions;
  }

  /**
   * Base notebook of the merge
   */
  base: nbformat.INotebookContent

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
      cells = cells.concat([createUnchangedCellMergeModel(bc, this.mimetype)]);
    }

    let insertOffset = 0;
    // Assumes merge decisions come in order!
    for (let md of this.mergeDecisions) {
      let key = md.common_path;
      if (key.lastIndexOf("/cells", 0) !== 0) {
        continue;   // Only care about decisions on cells here
      }

      let diffs = [md.local_diff, md.remote_diff];
      if (md.action === "custom") {
        diffs = diffs.concat(md.custom_diff);
      }
      if (key === "/cells") {
        let idx: number = null;
        for (let di of diffs) {
          // Ensure diff has exactly one item:
          if (!di || di.length == 0) {
            continue;
          }
          // All keys should be the same since we run splitCellChunks first
          idx = (di[0].key as number);
          if (di[0].op === DiffOp.SEQINSERT) {
            let insertedCells = createInsertedCellMergeModels(md, this.mimetype);

            // Insert entries into `cells` at idx
            let offsetIdx = insertOffset + idx;
            cells = cells.slice(0, offsetIdx).
                concat(insertedCells).
                concat(cells.slice(offsetIdx));
            insertOffset += insertedCells.length;
            break;
          }
          // Only checking for insertions in this loop, since insertions can
          // only be paired with other insertions.
        }
        // If we reach this point, it is not an insertion merge!
        if (idx === null) {
          throw "No index could be found for merge decision!"
        }
        let c = cells[idx + insertOffset];
        let base = this.base.cells[idx];
        // Modify local diff model as needed
        if (md.local_diff && md.local_diff.length == 1) {
          let d = md.local_diff[0];
          if (d.op == DiffOp.SEQDELETE) {
            // We rely on these to be split into individual decisions per cell!
            console.assert((d as IDiffRemoveRange).length === 1);
            c.local = createDeletedCellDiffModel(base, this.mimetype);
          } else if (d.op == DiffOp.PATCH) {
            let subdiff = (d as IDiffPatch).diff;
            c.local = createPatchedCellDiffModel(base, subdiff, this.mimetype);
          }
        }

        // Modify remote diff model as needed
        if (md.remote_diff && md.remote_diff.length == 1) {
          let d = md.remote_diff[0];
          if (d.op == DiffOp.SEQDELETE) {
            // We rely on these to be split into individual decisions per cell!
            console.assert((d as IDiffRemoveRange).length === 1);
            c.remote = createDeletedCellDiffModel(base, this.mimetype);
          } else if (d.op == DiffOp.PATCH) {
            let subdiff = (d as IDiffPatch).diff;
            c.remote = createPatchedCellDiffModel(base, subdiff, this.mimetype);
          }
        }

        // Modify merged diff model as needed
        if (!md.action || md.action == "base") {
          // Keep unchanged model
        } else if (md.action == "local") {
          c.merged = c.local; // deepcopy?
        } else if (md.action == "remote") {
          c.merged = c.remote;
        } else if (md.action == "custom") {
          // TODO: Apply intelligently!
        } else {
          throw "Action \"" + md.action + "\" is not valid for a cell!";
        }
      } else {
        // Has a path into a cell
        let idx = key.split('/', 3)[2];
      }
    }

    return cells;
  }
}
