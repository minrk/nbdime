// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  IDiffEntry, getDiffKey
} from './diffutil';

import {
  NotebookDiffModel, CellDiffModel, IStringDiffModel
} from './diffmodel';



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
        localDiff: IDiffEntry[],
        remoteDiff: IDiffEntry[],
        mergedDiff: IDiffEntry[]) {

    this.local = new NotebookDiffModel(base, localDiff);
    this.remote = new NotebookDiffModel(base, remoteDiff);
    this.merged = new NotebookDiffModel(base, mergedDiff);

    this.cells = this.buildCellList();
  }

  /**
   * Model of the local diff vs. base
   */
  local: NotebookDiffModel;

  /**
   * Model of the remote diff vs. base
   */
  remote: NotebookDiffModel;

  /**
   * The merged notebook diff vs base
   */
  merged: NotebookDiffModel;

  /**
   * List off individual cell merges
   */
  cells: CellMergeModel[];

  /**
   * Correlate the different cells in the diff lists into a merge list
   */
  protected buildCellList(): CellMergeModel[] {
    // This relies on the following assumptions of the merge routine:
    // 1. The merged cell list first takes local changes then remote changes
    //    for auto-resolved simultaneous insertions
    let lcs = this.local.cells, rcs = this.remote.cells, mcs = this.merged.cells;
    let maxlen = Math.max(lcs.length, rcs.length, mcs.length);

    let cells: CellMergeModel[] = [];
    let loff = 0, roff = 0, moff = 0;
    for (let i=0; i<maxlen; i++) {
      let rc: CellDiffModel = null, mc: CellDiffModel = null;
      let lc = lcs[i - loff];
      // TODO: Check what happens if two cells are inserted in local and remote!
      if (lc.added) {
        roff++;
        rc = null;
      } else {
        rc = rcs[i - roff];
        if (rc.added) {
          loff++;
          lc = null;
        }
      }
      mc = mcs[i - moff];

      cells = cells.concat([new CellMergeModel(lc, rc, mc)]);
    }
    return cells;
  }
}
