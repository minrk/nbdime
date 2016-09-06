// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  IDiffAddRange, IDiffPatch, IDiffRemoveRange, DiffOp, DiffRangePos, raw2Pos,
  IDiffEntry
} from './diffutil';

import {
  CellDiffModel, createAddedCellDiffModel, StringDiffModel, IStringDiffModel,
  createDeletedCellDiffModel, createPatchedCellDiffModel,
  createUnchangedCellDiffModel, setMimetypeFromCellType, OutputDiffModel,
  makeOutputModels, createPatchDiffModel, createDirectDiffModel
} from './diffmodel';

import {
  IMergeDecision, MergeDecision, resolveCommonPaths, buildDiffs,
  filterDecisions, pushPatchDecision, popPath, applyDecisions, Action
} from './mergedecision';

import {
   LineChunker, Chunk, labelSource
} from './chunking';

import {
  stringify, patchStringified, patch
} from './patch';

import {
  arraysEqual, valueIn
} from './util';


export
class DecisionStringDiffModel extends StringDiffModel {
  constructor(base: any, decisions: MergeDecision[],
              sourceModels: IStringDiffModel[],
              collapsible?: boolean, header?: string, collapsed?: boolean) {
    // Set up initial parameters for super call
    let baseStr = (typeof base === 'string') ? base as string : stringify(base);
    super(baseStr, '', [], [],
      collapsible, header, collapsed);
    this.rawBase = base;
    this.decisions = decisions;
    this._outdated = true;
    this._sourceModels = sourceModels;
    this._update();
  }

  decisions: MergeDecision[];

  rawBase: any;

  get additions(): DiffRangePos[] {
    if (this._outdated) {
      this._update();
    }
    return this._additions;
  }
  set additions(value: DiffRangePos[]) {
    this._additions = value;
  }

  get deletions(): DiffRangePos[] {
    if (this._outdated) {
      this._update();
    }
    return this._deletions;
  }
  set deletions(value: DiffRangePos[]) {
    this._deletions = value;
  }

  get remote(): string {
    if (this._outdated) {
      this._update();
    }
    return this._remote;
  }
  set remote(value: string) {
    this._remote = value;
  }

  invalidate() {
    this._outdated = true;
  }

  get invalid(): boolean {
    return this._outdated;
  }

  /**
   * Chunk additions/deletions into line-based chunks, while also producing
   * chunks from source models where the decision is a no-op (action 'base').
   */
  getLineChunks(): Chunk[] {
    let models = [this as IStringDiffModel].concat(this._sourceModels);
    let chunker = new LineChunker();
    let iter = new StringDiffModel.SyncedDiffIter(models);
    for (let v = iter.next(); !iter.done; v = iter.next()) {
      if (iter.currentModel() === this) {
        // Chunk diffs in own model normally
        chunker.addDiff(v.range, v.isAddition);
      } else {
        // Skip ops in other models that are not no-ops
        if (!v.range.source || v.range.source.decision.action !== 'base') {
          continue;
        }
        // Other model
        chunker.addGhost(v.range, v.isAddition, iter.currentOffset());
      }
    }
    return chunker.chunks;
  }

  protected _update(): void {
    this._outdated = false;
    let diff = buildDiffs(this.rawBase, this.decisions, 'merged');
    let out = patchStringified(this.rawBase, diff);
    this._additions = raw2Pos(out.additions, out.remote);
    this._deletions = raw2Pos(out.deletions, this.base);
    this._remote = out.remote;
  }

  protected _additions: DiffRangePos[];
  protected _deletions: DiffRangePos[];
  protected _remote: string;
  protected _outdated: boolean;
  protected _sourceModels: IStringDiffModel[]
}


function createPatchedCellDecisionDiffModel(
    base: nbformat.ICell, decisions: MergeDecision[], mimetype: string,
    local: CellDiffModel, remote: CellDiffModel):
    CellDiffModel {
  let source: DecisionStringDiffModel = null;
  let metadata: DecisionStringDiffModel = null;
  let outputs: OutputDiffModel[] = null;

  for (let md of decisions) {
    if (md.localPath.length === 0) {
      let val = popPath(md.diffs, true);
      console.assert(val !== null);
      md.diffs = val.diffs;
      md.pushPath(val.key);
    }
  }

  source = new DecisionStringDiffModel(
    base.source, filterDecisions(decisions, ['source'], 2),
    [local.source, remote.source]);
  setMimetypeFromCellType(source, base, mimetype);

  let metadataDec = filterDecisions(decisions, ['metadata'], 2);
  if (metadataDec.length > 0) {
    metadata = new DecisionStringDiffModel(
      base.metadata, metadataDec,
      [local.metadata, remote.metadata]);
  }

  if (base.cell_type === 'code' && (base as nbformat.ICodeCell).outputs) {
    let outputBase = (base as nbformat.ICodeCell).outputs;
    let outputDec = filterDecisions(decisions, ['outputs'], 2);
    let mergedDiff = buildDiffs(outputBase, outputDec, 'merged');
    let merged: nbformat.IOutput[] = null;
    if (mergedDiff && mergedDiff.length > 0) {
      merged = patch(outputBase, mergedDiff)
    } else {
      merged = outputBase;
    }
    outputs = makeOutputModels(outputBase, merged, mergedDiff);
  }
  return new CellDiffModel(source, metadata, outputs, base.cell_type);
}


/**
 * Abstract base class for a merge model of objects of the type ObjectType,
 * which uses DiffModelType to model each side internally.
 *
 * Implementors need to define the abstract functions createDiffModel and
 * createMergedDiffModel.
 */
export
abstract class ObjectMergeModel<ObjectType, DiffModelType> {

  /**
   * Create a diff model of the correct type given the diff (which might be
   * null)
   */
  protected abstract createDiffModel(diff: IDiffEntry[]): DiffModelType;

  /**
   * Create a diff model of the correct type for the merge given the diff
   */
  protected abstract createMergedDiffModel(): DiffModelType;

  /**
   *
   */
  constructor(base: ObjectType, decisions: MergeDecision[], mimetype: string,
              whitelist?: string[]) {
    this.base = base;
    this.mimetype = mimetype;
    this._whitelist = whitelist || null;

    this.decisions = decisions;
  }

  /**
   * Base value of the object
   */
  base: ObjectType;

  /**
   * The mimetype to use for the source
   */
  mimetype: string;

  /**
   * The merge decisions that apply to this object
   */
  decisions: MergeDecision[];

  /**
   * Apply merge decisions to create the merged cell
   */
  serialize(): ObjectType {
    return applyDecisions(this.base, this.decisions) as ObjectType;
  }

  /**
   * Model of the local diff vs. base
   */
  get local(): DiffModelType {
    if (this._local === undefined) {
      // We're builiding from decisions
      this._finalizeDecisions();
      let diff = buildDiffs(this.base, this.decisions, 'local');
      this._local = this.createDiffModel(diff);
    }
    return this._local;
  }

  /**
   * Model of the remote diff vs. base
   */
  get remote(): DiffModelType {
    if (this._remote === undefined) {
      this._finalizeDecisions();
      let diff = buildDiffs(this.base, this.decisions, 'remote');
      this._remote = this.createDiffModel(diff);
    }
    return this._remote;
  }

  /**
   * Model of the diff of the merged cell vs. base
   */
  get merged(): DiffModelType {
    if (this._merged === undefined) {
      this._finalizeDecisions();
      // Merge model needs access to local and remote models to also include
      // chunks from them
      this._merged = this.createMergedDiffModel();
    }
    return this._merged;
  }

  /**
   *
   */
  get subModels(): DiffModelType[] {
    return [this.local, this.remote, this.merged];
  }

  /**
   * Prevent further changes to decisions, and label the diffs
   *
   * The labels are used for picking of decisions
   */
  protected _finalizeDecisions(): void {
    if (!this._finalized) {
      for (let md of this.decisions) {
        if (md.action === 'either') {
          labelSource(md.localDiff, {decision: md, action: 'either'});
          labelSource(md.remoteDiff, {decision: md, action: 'either'});
        } else {
          labelSource(md.localDiff, {decision: md, action: 'local'});
          labelSource(md.remoteDiff, {decision: md, action: 'remote'});
        }
        labelSource(md.customDiff, {decision: md, action: 'custom'});
      }
      this._finalized = true;
    }
  }


  /**
   * Split a decision with a patch on one side into a set of new, one-sided
   * patch opertations. Useful to split a deletion vs patch decision.
   */
  protected splitPatch(md: MergeDecision, patch: IDiffPatch, local: boolean): MergeDecision[] {
    // Split patch on source, metadata and outputs, and make new decisions
    let diff = patch.diff;
    let out: MergeDecision[] = [];
    for (let d of diff) {
      if (this._whitelist && !valueIn(d.key, this._whitelist)) {
        throw 'Currently not able to handle decisions on variable \"' +
              d.key + '\"';
      }
      let action: Action = (md.action === 'base' ?
        local ? 'local' : 'remote' :
        md.action);
      out.push(new MergeDecision(
        md.absolutePath.concat([patch.key]),
        local ? [d] : null,
        local ? null : [d],
        action,
        md.conflict));
    }
    return out;
  }

  /**
   * List of fields to handle
   */
  protected _whitelist: string[];

  protected _local: DiffModelType;
  protected _remote: DiffModelType;
  protected _merged: DiffModelType;

  protected _finalized: boolean = false;
}


/**
 * CellMergeModel
 */
export class CellMergeModel extends ObjectMergeModel<nbformat.ICell, CellDiffModel> {
  constructor(base: nbformat.ICell, decisions: MergeDecision[], mimetype: string) {
    // TODO: Remove/extend whitelist once we support more
    super(base, decisions, mimetype, ['source', 'metadata', 'outputs'])
    this.onesided = false;
    this.deleteCell = false;

    // First check for cell-level decisions:
    if (decisions.length === 1 &&
        arraysEqual(decisions[0].absolutePath, ['cells'])) {
      // We have a cell level decision
      let md = decisions[0];
      decisions = this._applyCellDecision(md);
    }
    this.decisions = [];
    for (let md of decisions) {
      // Make local path relative to cell
      md.level = 2;
      this.decisions.push(md);
    }
  }

  /**
   * Whether the cell is present in only one of the two side (local/remote)
   */
  onesided: boolean;

  /**
   * Run time flag whether the user wants to delete the cell or not
   */
  deleteCell: boolean;

  /**
   *
   */
  addDecision(decision: MergeDecision) {
    // Don't allow additional decision if we've already made models!
    if (this._local || this._remote || this._merged) {
      if (this._finalized) {
        throw 'Cannot add a decision to a finalized cell merge model';
      } else {
        throw 'Cannot add more than one cell level decision to one cell';
      }
    } else if (decision.absolutePath.length < 1 ||
               decision.absolutePath[0] !== 'cells') {
      throw 'Not a valid path for a cell decision';
    }

    let ldlen = decision.localDiff ? decision.localDiff.length : 0;
    let rdlen = decision.remoteDiff ? decision.remoteDiff.length : 0;

    // Check if cell level or not:
    if (arraysEqual(decision.absolutePath, ['cells']) ) {
      // Cell level decision (addrange/removerange):
      let decisions = this._applyCellDecision(decision);
      // Add transformed decisions to model:
      for (let md of decisions) {
        md.level = 2;
        this.decisions.push(md);
      }
    } else if (decision.absolutePath.length === 2 && (ldlen > 1 || rdlen > 1)) {
      console.assert(valueIn(0, [ldlen, rdlen]));
      // More than one diff op on cell level, split decisions on key
      // Translate decision to format taken by _splitPatch, and apply:
      decision = pushPatchDecision(decision, decision.absolutePath.slice(1, 2));
      let diff = (ldlen ? decision.localDiff : decision.remoteDiff)[0] as IDiffPatch;
      let decisions = this.splitPatch(decision, diff, !rdlen);
      resolveCommonPaths(decisions);
      for (let md of decisions) {
        md.level = 2;
        this.decisions.push(md);
      }
    } else {
      // Either single diff op on cell level, or a decision on a subpath
      // Valid path assured by above tests
      decision.level = 2;
      this.decisions.push(decision);
    }
  }

  /**
   * Apply merge decisions to create the merged cell
   */
  serialize(): nbformat.ICell {
    let decisions: MergeDecision[] = [];
    for (let md of this.decisions) {
      let nmd = new MergeDecision(md);
      nmd.level = 2;
      decisions.push(nmd);
    }
    return applyDecisions(this.base, decisions) as nbformat.ICell;
  }

  protected createDiffModel(diff: IDiffEntry[]): CellDiffModel {
      if (diff && diff.length > 0) {
        return createPatchedCellDiffModel(this.base, diff, this.mimetype);
      } else {
        return createUnchangedCellDiffModel(this.base, this.mimetype);
      }
  }

  protected createMergedDiffModel(): CellDiffModel {
    return createPatchedCellDecisionDiffModel(
        this.base, this.decisions, this.mimetype, this.local, this.remote);
  }

  /**
   * Apply a cell level decision to the model
   *
   * This creates the revelant kinds of models
   */
  protected _applyCellDecision(md: MergeDecision): MergeDecision[] {
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
    console.assert(!this.onesided,
                   'Cannot have multiple cell decisions on one cell!');
    this.onesided = true;  // We set this to distinguish case 3 from normal
    let ld = md.localDiff !== null && md.localDiff.length !== 0;
    let rd = md.remoteDiff !== null && md.remoteDiff.length !== 0;
    if (!ld) {
      // 1. or 2.:
      this._local = null;
      console.assert(md.remoteDiff.length === 1);
      if (this.base === null) {
        // 1.
        console.assert(md.remoteDiff[0].op === DiffOp.SEQINSERT);
        let v = (md.remoteDiff[0] as IDiffAddRange).valuelist[0];
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
      console.assert(md.localDiff.length === 1);
      if (this.base === null) {
        // 1.
        console.assert(md.localDiff[0].op === DiffOp.SEQINSERT);
        let v = (md.localDiff[0] as IDiffAddRange).valuelist[0];
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
      console.assert(md.localDiff.length === 1 && md.remoteDiff.length === 1);
      // 3. or 4.
      if (md.localDiff[0].op === md.remoteDiff[0].op) {
        // 4.
        if (this.base === null) {
          // Identical insertions (this relies on preprocessing to ensure only
          // one value in valuelist)
          let v = (md.localDiff[0] as IDiffAddRange).valuelist[0];
          this._local = createAddedCellDiffModel(v, this.mimetype);
          this._remote = createAddedCellDiffModel(v, this.mimetype);
          this._merged = createAddedCellDiffModel(v, this.mimetype);
        } else {
          // Identical delections
          this._local = createDeletedCellDiffModel(this.base, this.mimetype);
          this._remote = createDeletedCellDiffModel(this.base, this.mimetype);
          this._merged = createDeletedCellDiffModel(this.base, this.mimetype);
          this.deleteCell = valueIn(md.action, ['local', 'remote', 'either']);
        }
      } else {
        // 3., by method of elimination
        let ops = [md.localDiff[0].op, md.remoteDiff[0].op];
        console.assert(
          valueIn(DiffOp.SEQDELETE, ops) && valueIn(DiffOp.PATCH, ops));
        if (ops[0] === DiffOp.SEQDELETE) {
          this._local = createDeletedCellDiffModel(this.base, this.mimetype);
          this.deleteCell = md.action === 'local';
          // The patch op will be on cell level. Split it on sub keys!
          newDecisions = newDecisions.concat(this.splitPatch(
            md, md.remoteDiff[0] as IDiffPatch, false));
        } else {
          this._remote = createDeletedCellDiffModel(this.base, this.mimetype);
          this.deleteCell = md.action === 'remote';
          // The patch op will be on cell level. Split it on sub keys!
          newDecisions = newDecisions.concat(this.splitPatch(
            md, md.localDiff[0] as IDiffPatch, true));
        }
      }
    }
    return newDecisions;
  }
}


/**
 * Model of a merge of metadata with decisions
 */
export
class MetadataMergeModel extends ObjectMergeModel<nbformat.INotebookMetadata, IStringDiffModel> {
  constructor(base: nbformat.INotebookMetadata, decisions: MergeDecision[], mimetype: string) {
    super(base, decisions, mimetype);
  }

  protected createDiffModel(diff: IDiffEntry[]): IStringDiffModel {
    if (diff && diff.length > 0) {
      return createPatchDiffModel(this.base, diff);
    } else {
      return createDirectDiffModel(this.base, this.base);
    }
  }

  protected createMergedDiffModel(): IStringDiffModel {
    return new DecisionStringDiffModel(
      this.base, this.decisions,
      [this.local, this.remote]);
  }
}



/**
 * The merge format allows for chunking of sequence diffs such that one entry
 * in the diff lists have 2 entries, where the first is always an insertion
 * (addrange). For cells, we split these decisions in two, for easier
 * visualization.
 */
function splitCellChunks(mergeDecisions: MergeDecision[]): MergeDecision[] {
  let output: MergeDecision[] = [];
  for (let md of mergeDecisions) {
    if (arraysEqual(md.absolutePath, ['cells'])) {
      if (md.localDiff && !md.remoteDiff) {
        for (let d of md.localDiff) {
          let nmd = new MergeDecision(md);
          nmd.localDiff = [d];
          output.push(nmd);
        }
      } else if (md.remoteDiff && !md.localDiff) {
        for (let d of md.remoteDiff) {
          let nmd = new MergeDecision(md);
          nmd.absolutePath = md.absolutePath.slice();
          nmd.remoteDiff = [d];
          output.push(nmd);
        }
      } else if (md.localDiff && md.localDiff.length === 2) {
        // Split off local
        output.push(new MergeDecision(
          md.absolutePath.slice(),
          md.localDiff.slice(0, 1),
          [],
          'local', // Check for custom action first?
          md.conflict
        ));
        let nmd = new MergeDecision(md);
        nmd.localDiff = md.localDiff.slice(1);
        output.push(nmd);
      } else if (md.remoteDiff && md.remoteDiff.length === 2) {
        // Split off remote
        output.push(new MergeDecision(
          md.absolutePath.slice(),
          [],
          md.remoteDiff.slice(0, 1),
          'remote', // Check for custom action first?
          md.conflict
        ));
        let nmd = new MergeDecision(md);
        nmd.remoteDiff = md.remoteDiff.slice(1);
        output.push(nmd);
      } else {
        output.push(md);  // deepCopy?
      }
    } else {
      output.push(md);
    }
  }
  resolveCommonPaths(output);
  return output;
}


/**
 * Split "removerange" diffs on cell list level into individual decisions!
 */
function splitCellRemovals(mergeDecisions: MergeDecision[]): MergeDecision[] {
  let output: MergeDecision[] = [];

  let makeSplitPart = function(md: MergeDecision, key: number,
                               local: boolean, remote: boolean): MergeDecision {
    let newMd = new MergeDecision(md.absolutePath.slice(), null, null,
                                  md.action, md.conflict);
    let newDiff = [{
        key: key,
        op: DiffOp.SEQDELETE,
        length: 1
    }];
    console.assert(local || remote);
    if (local) {
      newMd.localDiff = newDiff;
    }
    if (remote) {
      newMd.remoteDiff = newDiff;
    }
    return newMd;
  };

  for (let md of mergeDecisions) {
    if (!arraysEqual(md.absolutePath, ['cells'])) {
      output.push(md);
      continue;
    }

    let dl = md.localDiff && md.localDiff.length > 0 ? md.localDiff[md.localDiff.length - 1] : null;
    let dr = md.remoteDiff && md.remoteDiff.length > 0 ? md.remoteDiff[md.remoteDiff.length - 1] : null;
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
              newMd.remoteDiff = [pOp];
            } else  {
              newMd.localDiff = [pOp];
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
function splitCellInsertions(mergeDecisions: MergeDecision[]): MergeDecision[] {
  let output: MergeDecision[] = [];

  let makeSplitPart = function(md: MergeDecision, value: any,
                               local: boolean, remote: boolean): MergeDecision {
    let newMd = new MergeDecision(md.absolutePath.slice(), null, null,
                                  md.action, md.conflict);
    let key = (local ? md.localDiff : md.remoteDiff)[0].key;
    let newDiff = [{
        key: key,
        op: DiffOp.SEQINSERT,
        valuelist: [value]
    }];

    console.assert(local || remote);
    if (local) {
      newMd.localDiff = newDiff;
    }
    if (remote) {
      newMd.remoteDiff = newDiff;
    }
    return newMd;
  };

  for (let md of mergeDecisions) {
    // Just push decisions not on cells list:
    if (!arraysEqual(md.absolutePath, ['cells'])) {
      output.push(md);
      continue;
    }

    // Check wether all diffs are pure addrange
    let correctType = true;
    if (md.localDiff) {
      for (let dl of md.localDiff) {
        if (dl.op !== DiffOp.SEQINSERT) {
          correctType = false;
          break;
        }
      }
    }
    if (md.remoteDiff) {
      for (let dl of md.remoteDiff) {
        if (dl.op !== DiffOp.SEQINSERT) {
          correctType = false;
          break;
        }
      }
    }
    if (!correctType) {
      output.push(md);
      continue;
    }

    let dl = md.localDiff && md.localDiff.length === 1 ? md.localDiff[0]  as IDiffAddRange : null;
    let dr = md.remoteDiff && md.remoteDiff.length === 1 ? md.remoteDiff[0] as IDiffAddRange : null;

    if (dl && !dr || dr && !dl) {
      // One-way diff
      let d = dl ? md.localDiff[0] : md.remoteDiff[0];
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
            output.push(makeSplitPart(md, c, false, true));
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

  static preprocessDecisions(rawMergeDecisions: IMergeDecision[]): MergeDecision[] {
    let mergeDecisions: MergeDecision[] = [];
    for (let rmd of rawMergeDecisions) {
      mergeDecisions.push(new MergeDecision(rmd));
    }
    mergeDecisions = splitCellChunks(mergeDecisions);
    mergeDecisions = splitCellRemovals(mergeDecisions);
    mergeDecisions = splitCellInsertions(mergeDecisions);
    resolveCommonPaths(mergeDecisions);
    for (let md of mergeDecisions) {
      if (md.action === 'either') {
        labelSource(md.localDiff, {decision: md, action: 'either'});
        labelSource(md.remoteDiff, {decision: md, action: 'either'});
      } else {
        labelSource(md.localDiff, {decision: md, action: 'local'});
        labelSource(md.remoteDiff, {decision: md, action: 'remote'});
      }
      labelSource(md.customDiff, {decision: md, action: 'custom'});
    }
    return mergeDecisions;
  }

  /**
   * Create a new NotebookDiffModel from a base notebook and a list of diffs.
   *
   * The base as well as the diff entries are normally supplied by the nbdime
   * server.
   */
  constructor(base: nbformat.INotebookContent,
              rawMergeDecisions: IMergeDecision[]) {
    this.base = base;
    let ctor = this.constructor as typeof NotebookMergeModel;
    let decisions = ctor.preprocessDecisions(rawMergeDecisions);

    // The notebook metadata MIME type is used for determining the MIME type
    // of source cells, so store it easily accessible:
    try {
      this.mimetype = base.metadata.language_info.mimetype;
    } catch (e) {
      // missing metadata, guess python (probably old notebook)
      this.mimetype = 'text/python';
    }

    this.cells = this.buildCellList(decisions);

    let metadataDecs = filterDecisions(decisions, ['metadata']);
    if (metadataDecs.length > 0) {
      this.metadata = new MetadataMergeModel(base.metadata, metadataDecs,
        this.mimetype);
    }
    this.unsavedChanges = false;
  }


  serialize(): nbformat.INotebookContent {
    let nb = {};
    // Simply copy all root-level fields except cells/metadata
    for (let key in this.base) {
      if (!valueIn(key, ['cells', 'metadata'])) {
        nb[key] = this.base[key]
      }
    }

    // Serialize metadata
    nb['metadata'] = this.metadata.serialize();

    // Serialzie cell list
    let cells: nbformat.ICell[] = [];
    for (let c of this.cells) {
      cells.push(c.serialize());
    }
    nb['cells'] = cells;

    // As long as base is a valid notebook, and sub-serialization is valid,
    // this output should be a valid notebook.
    return nb as nbformat.INotebookContent;
  }

  decisions(): MergeDecision[] {
    let ret: MergeDecision[] = [];
    for (let c of this.cells) {
      ret = ret.concat(c.decisions);
    }
    return ret;
  }

  conflicts(): MergeDecision[] {
    let ret: MergeDecision[] = [];
    for (let md of this.decisions()) {
      if (md.conflict) {
        ret.push(md);
      }
    }
    return ret;
  }

  /**
   * Base notebook of the merge
   */
  base: nbformat.INotebookContent;

  /**
   * List of individual cell merges
   */
  cells: CellMergeModel[];

  /**
   * Metadata merge model
   */
  metadata: MetadataMergeModel;

  /**
   * The default MIME type according to the notebook's root metadata
   */
  mimetype: string;

  /**
   * Whether there are unsaved changes
   */
  unsavedChanges: boolean;

  /**
   * Correlate the different cells in the diff lists into a merge list
   */
  protected buildCellList(decisions: MergeDecision[]): CellMergeModel[] {
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
    for (let md of decisions) {
      let key = md.absolutePath;
      if (key.length < 1 || key[0] !== 'cells') {
        continue;   // Only care about decisions on cells here
      }

      if (arraysEqual(key, ['cells'])) {
        let idx: number = null;
        let insertion = false;
        for (let di of md.diffs) {
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
