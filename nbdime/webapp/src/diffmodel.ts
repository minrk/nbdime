// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  DiffOp, IDiffEntry, IDiffAddRange, IDiffRemoveRange, IDiffPatch,
  getDiffKey, DiffRangeRaw, DiffRangePos, raw2Pos
} from './diffutil';

import {
  ChunkSource
} from './mergedecision';

import {
  patchStringified, stringify, patch
} from './patch';

import * as CodeMirror from 'codemirror';

// CHUNKING

/**
 * A chunk is a range of lines in a string based diff
 * that logically belong together.
 *
 * Chunks can be used for:
 *  - Correlating diff entries in the base and remote, e.g.
 *    for aligning lines in two editors.
 *  - Finding parts of the unchanged text that are not needed
 *    as context (can be hidden)
 *  - Navigating a diff ("Go to next diff")
 */
export class Chunk {
  constructor(
      public editFrom: number,
      public editTo: number,
      public origFrom: number,
      public origTo: number,
      source?: ChunkSource) {
    if (source) {
      this.source = source;
    }
    this.source = source || null;
  }

  /**
   * Indicates the source of a chunk in a merge condition.
   *
   * For merged content this can be used to indicate whther the chunk originates
   * from base, local, remote or somewhere else.
   */
  source: ChunkSource;

  /**
   * Checks whether the given line number is within the range spanned by editFrom - editTo
   */
  inEdit(line: number) {
    return line >= this.editFrom && line <= this.editTo;
  }

  /**
   * Checks whether the given line number is within the range spanned by origFrom - origTo
   */
  inOrig(line: number) {
    return line >= this.origFrom && line <= this.origTo;
  }
};


// DIFF MODELS:

/**
 * Describes a model whose view can be collapsible.
 *
 * Intended as hints for a view of the model, and not a requirement.
 */
export interface ICollapsibleModel {
  /**
   * Whether a view of the model should be collapsible (hint)
   */
  collapsible: boolean;

  /**
   * String to show in header of collapser element
   */
  collapsibleHeader: string;

  /**
   * The initial state of a collapsible view
   */
  startCollapsed: boolean;
}

/**
 * Base interface for diff models.
 */
export interface IDiffModel extends ICollapsibleModel {
  /**
   * Is diff no-op?
   */
  unchanged: boolean;

  /**
   * Whether diff represents a simple addtion
   */
  added: boolean;

  /**
   * Whether diff represents a simple deletion
   */
  deleted: boolean;
}


/**
 * Interface for a string diff model.
 *
 * String diff models are used for any content where the final
 * diff should be presented as a difference between strings
 * (as compared to e.g. images). As such, it is NOT restricted
 * to cases where original content is in a string format.
 */
export interface IStringDiffModel extends IDiffModel {
  /**
   * Base value
   */
  base: string;

  /**
   * Remote value
   */
  remote: string;

  /**
   * Mimetype of the data the string represents.
   *
   * Can be used for things such as syntax highlighting.
   */
  mimetype: string;

  /**
   * Location of additions, as positions in the remote value.
   *
   * Locations should be sorted on the ranges' `from` position
   */
  additions: DiffRangePos[];

  /**
   * Location of deletions, as positions in the base value.
   *
   * Locations should be sorted on the ranges' `from` position
   */
  deletions: DiffRangePos[];


  /**
   * A function that will separate the diff into chunks.
   */
  getChunks(): Chunk[];
}


/**
 * Standard implementation of the IStringDiffModel interface.
 */
export class StringDiffModel implements IStringDiffModel {

  /**
   * StringDiffModel constructor.
   *
   * Will translate additions and deletions from absolute
   * coordinates, into {line, ch} based coordinates.
   * Both should be sorted on the `from` position before passing.
   *
   * Collapsible and collapsed both defaults to false.
   */
  constructor(
        public base: string,
        public remote: string,
        additions: DiffRangeRaw[],
        deletions: DiffRangeRaw[],
        collapsible?: boolean,
        header?: string,
        collapsed?: boolean) {
    if (base === null) {
      console.assert(deletions.length === 0);
      this.deletions = [];
    } else {
      this.deletions = raw2Pos(deletions, base);
    }
    if (remote === null) {
      console.assert(additions.length === 0);
      this.additions = [];
    } else {
      this.additions = raw2Pos(additions, remote);
    }

    this.collapsible = collapsible === true;
    if (this.collapsible) {
      this.collapsibleHeader = header ? header : '';
      this.startCollapsed = collapsed;
    }
  }

  /**
   * Uses Chunk.inOrig/inEdit to determine diff entry overlap.
   */
  getChunks(): Chunk[] {
    let chunks: Chunk[] = [];
    let startEdit = 0, startOrig = 0, editOffset = 0;
    let edit = CodeMirror.Pos(0, 0), orig = CodeMirror.Pos(0, 0);
    let ia = 0, id = 0;

    let current: Chunk = null;
    let isAddition: boolean = null;
    let range: DiffRangePos = null;
    let additions = this.additions;
    let deletions = this.deletions;
    for (; ; ) {
      // Figure out which element to take next
      if (ia < additions.length) {
        if (id < deletions.length) {
          let ra = additions[ia];
          let rd = deletions[id];
          if (ra.from.line < rd.from.line - editOffset ||
                (ra.from.line === rd.from.line - editOffset &&
                 ra.from.ch <= rd.from.ch)) {
            // TODO: Character editOffset should also be used
            isAddition = true;
          } else {
            isAddition = false;
          }
        } else {
          // No more deletions
          isAddition = true;
        }
      } else if (id < deletions.length) {
        // No more additions
        isAddition = false;
      } else {
        if (current) { chunks.push(current); }
        break;
      }

      if (isAddition) {
        range = additions[ia++];
      } else {
        range = deletions[id++];
      }
      let linediff = range.to.line - range.from.line;
      if (range.endsOnNewline) {
        linediff += 1;
      }
      let firstLineNew = range.from.ch === 0 && linediff > 0;

      let startOffset = range.chunkStartLine ? 0 : 1;
      let endOffset =
        range.chunkStartLine && range.endsOnNewline && firstLineNew ?
        0 : 1;

      if (current) {
        // Have existing chunk, check for overlap
        if (isAddition) {
          if (current.inOrig(range.from.line)) {
            current.origTo = Math.max(current.origTo,
                range.to.line + endOffset + linediff);
            current.editTo = Math.max(current.editTo,
                range.to.line + endOffset + editOffset);
            console.assert(current.source.action === range.source.action);
          } else {
            // No overlap with chunk, start new one
            chunks.push(current);
            current = null;
          }
        } else {
          if (current.inEdit(range.from.line)) {
            current.origTo = Math.max(current.origTo,
                range.to.line + endOffset - editOffset);
            current.editTo = Math.max(current.editTo,
                range.to.line + endOffset + linediff);
            console.assert(current.source.action === range.source.action);
          } else {
            // No overlap with chunk, start new one
            chunks.push(current);
            current = null;
          }
        }
      }
      if (!current) {
        // No current chunk, start a new one
        if (isAddition) {
          startOrig = range.from.line;
          startEdit = startOrig + editOffset;
          current = new Chunk(
            startEdit + startOffset,
            startEdit + endOffset,
            startOrig + startOffset,
            startOrig + endOffset + linediff
          );
        } else {
          startEdit = range.from.line;
          startOrig = startEdit - editOffset;
          current = new Chunk(
            startEdit + startOffset,
            startEdit + endOffset + linediff,
            startOrig + startOffset,
            startOrig + endOffset
          );
        }
        current.source = range.source;
      }
      editOffset += isAddition ? -linediff : linediff;
    }
    return chunks;
  }

  get unchanged(): boolean {
    return this.base === this.remote;
  }

  get added(): boolean {
    return this.base === null;
  }

  get deleted(): boolean {
    return this.remote === null;
  }

  collapsible: boolean;
  collapsibleHeader: string;
  startCollapsed: boolean;

  mimetype: string;

  additions: DiffRangePos[];
  deletions: DiffRangePos[];
}


/**
 * Creates a StringDiffModel based on a patch operation.
 *
 * If base is not a string, it is assumed to be a JSON object,
 * and it will be stringified according to JSON stringification
 * rules.
 */
export function createPatchDiffModel(base: any, diff: IDiffEntry[]) : StringDiffModel {
  console.assert(!!diff, 'Patch model needs diff.');
  let baseStr = (typeof base === 'string') ? base as string : stringify(base);
  let out = patchStringified(base, diff);
  return new StringDiffModel(baseStr, out.remote, out.additions, out.deletions);
}

/**
 * Factory for creating cell diff models for added, removed or unchanged content.
 *
 * If base is null, it will be treated as added, if remote is null it will be
 * treated as removed. Otherwise base and remote should be equal, represeting
 * unchanged content.
 */
export function createDirectDiffModel(base: any, remote: any): StringDiffModel {
  let baseStr = (typeof base === 'string') ?
    base as string : stringify(base);
  let remoteStr = (typeof remote === 'string') ?
    remote as string : stringify(remote);
  let additions: DiffRangeRaw[] = [];
  let deletions: DiffRangeRaw[] = [];

  if (base === null) {
    // Added cell
    baseStr = null;
    additions.push(new DiffRangeRaw(0, remoteStr.length, undefined));
  } else if (remote === null) {
    // Deleted cell
    remoteStr = null;
    deletions.push(new DiffRangeRaw(0, baseStr.length, undefined));
  } else if (remoteStr !== baseStr) {
    throw 'Invalid arguments to createDirectDiffModel().' +
      'Either base or remote should be null, or they should be equal!';
  }
  return new StringDiffModel(baseStr, remoteStr, additions, deletions);
}



/**
 * Assign MIME type to an IStringDiffModel based on the cell type.
 *
 * The parameter nbMimetype is the MIME type set for the entire notebook, and is
 * used as the MIME type for code cells.
 */
export
function setMimetypeFromCellType(model: IStringDiffModel, cell: nbformat.ICell,
                                 nbMimetype: string) {
  let cellType = cell.cell_type;
  if (cellType === 'code') {
    model.mimetype = nbMimetype;
  } else if (cellType === 'markdown') {
    model.mimetype = 'text/markdown';
  } else if (cellType === 'raw') {
    model.mimetype = (cell as nbformat.IRawCell).metadata.format;
  }
}


/**
 * Diff model for single cell output entries.
 *
 * Can converted to a StringDiffModel via the method `stringify()`, which also
 * takes an optional argument `key` which specifies a subpath of the IOutput to
 * make the model from.
 */
export class OutputDiffModel implements IDiffModel {
  constructor(
        public base: nbformat.IOutput,
        remote: nbformat.IOutput,
        diff?: IDiffEntry[],
        collapsible?: boolean,
        header?: string,
        collapsed?: boolean) {
    if (!remote && diff) {
      this.remote = patch(base, diff) as nbformat.IOutput;
    } else {
      this.remote = remote;
    }
    this.diff = !!diff ? diff : null;
    this.collapsible = collapsible === true;
    if (this.collapsible) {
      this.collapsibleHeader = header ? header : '';
      this.startCollapsed = collapsed;
    }
  }

  get unchanged() : boolean {
    return this.diff === null;
  }

  get added(): boolean {
    return this.base === null;
  }

  get deleted(): boolean {
    return this.remote === null;
  }

  /**
   * Checks whether the given mimetype is present in the output's mimebundle.
   * If so, it returns the path/key to that mimetype's data. If not present,
   * it returns null.
   *
   * See also: innerMimeType
   */
  hasMimeType(mimetype: string): string {
    let t = this.base ? this.base.output_type : this.remote.output_type;
    if (t === 'stream' &&
          mimetype === 'application/vnd.jupyter.console-text') {
      return 'text';
    } else if (t === 'execute_result' || t === 'display_data') {
      let data = this.base ? (this.base as nbformat.IExecuteResult).data :
        (this.remote as nbformat.IExecuteResult).data;
      if (mimetype in data) {
        return 'data.' + mimetype;
      }
    }
    return null;
  }

  /**
   * Returns the expected MIME type of the IOutput subpath specified by `key`,
   * as determined by the notebook format specification.
   *
   * Throws an error for unknown keys.
   *
   * See also: hasMimeType
   */
  innerMimeType(key: string) : string {
    let t = this.base ? this.base.output_type : this.remote.output_type;
    if (t === 'stream' && key === 'text') {
      // TODO: 'application/vnd.jupyter.console-text'?
      return 'text/plain';
    } else if ((t === 'execute_result' || t === 'display_data') &&
          key.indexOf('data.') === 0) {
      return key.slice('data.'.length);
    }
    throw 'Unknown MIME type for key: ' + key;
  }

  /**
   * Can converted to a StringDiffModel via the method `stringify()`, which also
   * takes an optional argument `key` which specifies a subpath of the IOutput to
   * make the model from.
   */
  stringify(key?: string) : IStringDiffModel {
    let getMemberByPath = function(obj: any, key: string, f?: (obj: any, key: string) => any) {
      if (!obj) {
        return obj;
      }
      let i = key.indexOf('.');
      if (i >= 0) {
        console.assert(i < key.length);
        if (f) {
          return getMemberByPath(
            f(obj, key.slice(0, i)), key.slice(i + 1), f);
        }
        return getMemberByPath(
          obj[key.slice(0, i)], key.slice(i + 1), f);
      } else if (f) {
        return f(obj, key);
      }
      return obj[key];
    };
    let base = key ? getMemberByPath(this.base, key) : this.base;
    let remote = key ? getMemberByPath(this.remote, key) : this.remote;
    let diff = (this.diff && key) ?
      getMemberByPath(this.diff, key, getDiffKey) as IDiffEntry[] :
      this.diff;
    let model: IStringDiffModel = null;
    if (this.unchanged || this.added || this.deleted || !diff) {
      model = createDirectDiffModel(base, remote);
    } else {
      model = createPatchDiffModel(base, diff);
    }
    model.mimetype = key ? this.innerMimeType(key) : 'application/json';
    model.collapsible = this.collapsible;
    model.collapsibleHeader = this.collapsibleHeader;
    model.startCollapsed = this.startCollapsed;
    return model;
  }

  /**
   * Remote value
   */
  remote: nbformat.IOutput;

  /**
   * Diff entries between base and remote
   */
  diff: IDiffEntry[];

  // ICollapsibleModel:
  collapsible: boolean;
  collapsibleHeader: string;
  startCollapsed: boolean;
}


// CellDiffModel

/**
 * Diff model for individual Notebook Cells
 */
export class CellDiffModel {
  constructor(source: IDiffModel, metadata: IDiffModel,
              outputs: IDiffModel[], cellType: string) {
    this.source = source;
    this.metadata = metadata;
    this.outputs = outputs;
    this.cellType = cellType;
    if (this.metadata) {
      this.metadata.collapsible = true;
      this.metadata.collapsibleHeader = 'Metadata changed';
      this.metadata.startCollapsed = true;
    }
  }

  /**
   * Diff model for the source field.
   */
  source: IDiffModel;

  /**
   * Diff model for the metadata field. Can be null.
   */
  metadata: IDiffModel;

  /**
   * Diff model for the outputs field. Can be null.
   */
  outputs: IDiffModel[];

  /**
   * The type of the notebook cell
   */
  cellType: string;


  /**
   * Whether the cell has remained unchanged
   */
  get unchanged(): boolean {
    let unchanged = this.source.unchanged;
    unchanged = unchanged &&
      (this.metadata ? this.metadata.unchanged : true);
    if (this.outputs) {
      for (let o of this.outputs) {
        unchanged = unchanged && o.unchanged;
      }
    }
    return unchanged;
  }

  /**
   * Whether the cell has been added to the notebook (new cell)
   */
  get added(): boolean {
    return this.source.added;
  }

  /**
   * Whether the cell has been deleted/removed from the notebook
   */
  get deleted(): boolean {
    return this.source.deleted;
  }
}

export function createPatchedCellDiffModel(
    base: nbformat.ICell, diff: IDiffEntry[], nbMimetype: string): CellDiffModel {
  let source: IDiffModel = null;
  let metadata: IDiffModel = null;
  let outputs: IDiffModel[] = null;

  let subDiff = getDiffKey(diff, 'source');
  if (subDiff) {
    source = createPatchDiffModel(base.source, subDiff);
  } else {
    source = createDirectDiffModel(base.source, base.source);
  }
  setMimetypeFromCellType(source as IStringDiffModel, base, nbMimetype);

  subDiff = getDiffKey(diff, 'metadata');
  if (base.metadata !== undefined) {
    metadata = subDiff ?
      createPatchDiffModel(base.metadata, subDiff) :
      createDirectDiffModel(base.metadata, base.metadata);
  }

  if (base.cell_type === 'code' && (base as nbformat.ICodeCell).outputs) {
    outputs = makeOutputModels((base as nbformat.ICodeCell).outputs, null,
      getDiffKey(diff, 'outputs'));
  }
  return new CellDiffModel(source, metadata, outputs, base.cell_type);
}

export function createUnchangedCellDiffModel(
      base: nbformat.ICell, nbMimetype: string): CellDiffModel {
  let metadata: IDiffModel = null;
  let outputs: IDiffModel[] = null;

  let source = createDirectDiffModel(base.source, base.source);
  setMimetypeFromCellType(source as IStringDiffModel, base, nbMimetype);
  if (base.metadata !== undefined) {
    metadata = createDirectDiffModel(base.metadata, base.metadata);
  }
  if (base.cell_type === 'code' && (base as nbformat.ICodeCell).outputs) {
    outputs = makeOutputModels((base as nbformat.ICodeCell).outputs,
      (base as nbformat.ICodeCell).outputs);
  }
  return new CellDiffModel(source, metadata, outputs, base.cell_type);
}

export function createAddedCellDiffModel(
      remote: nbformat.ICell, nbMimetype: string): CellDiffModel {
  let metadata: IDiffModel = null;
  let outputs: IDiffModel[] = null;

  let source = createDirectDiffModel(null, remote.source);
  setMimetypeFromCellType(source as IStringDiffModel, remote, nbMimetype);
  if (remote.metadata !== undefined) {
    metadata = createDirectDiffModel(null, remote.metadata);
  }
  if (remote.cell_type === 'code' && (remote as nbformat.ICodeCell).outputs) {
    outputs = makeOutputModels(
      null, (remote as nbformat.ICodeCell).outputs);
  }
  return new CellDiffModel(source, metadata, outputs, remote.cell_type);
}

export function createDeletedCellDiffModel(
      base: nbformat.ICell, nbMimetype: string): CellDiffModel {
  let source: IDiffModel = null;
  let metadata: IDiffModel = null;
  let outputs: IDiffModel[] = null;

  source = createDirectDiffModel(base.source, null);
  setMimetypeFromCellType(source as IStringDiffModel, base, nbMimetype);
  if (base.metadata !== undefined) {
    metadata = createDirectDiffModel(base.metadata, null);
  }
  if (base.cell_type === 'code' && (base as nbformat.ICodeCell).outputs) {
    outputs = makeOutputModels((base as nbformat.ICodeCell).outputs, null);
  }
  return new CellDiffModel(source, metadata, outputs, base.cell_type);
}


function makeOutputModels(base: nbformat.IOutput[], remote: nbformat.IOutput[],
                          diff?: IDiffEntry[]) : IDiffModel[] {
  let models: IDiffModel[] = [];
  if (remote === null && !diff) {
    // Cell deleted
    for (let o of base) {
      models.push(new OutputDiffModel(o, null));
    }
  } else if (base === null) {
    // Cell added
    for (let o of remote) {
      models.push(new OutputDiffModel(null, o));
    }
  } else if (remote === base) {
    // Outputs unchanged
    for (let o of base) {
      models.push(new OutputDiffModel(o, o));
    }
  } else if (diff) {
    // Outputs' patched, remote will be null
    let consumed = 0;
    let skip = 0;
    for (let d of diff) {
      let index = d.key as number;
      for (let o of base.slice(consumed, index)) {
        // Add unchanged outputs
        models.push(new OutputDiffModel(o, o));
      }
      if (d.op === DiffOp.SEQINSERT) {
        // Outputs added
        for (let o of (d as IDiffAddRange).valuelist) {
          models.push(new OutputDiffModel(null, o));
        }
        skip = 0;
      } else if (d.op === DiffOp.SEQDELETE) {
        // Outputs removed
        let len = (d as IDiffRemoveRange).length;
        for (let i = index; i < index + len; i++) {
          models.push(new OutputDiffModel(base[i], null));
        }
        skip = len;
      } else if (d.op === DiffOp.PATCH) {
        // Output changed
        models.push(new OutputDiffModel(
          base[index], null, (d as IDiffPatch).diff));
        skip = 1;
      } else {
        throw 'Invalid diff operation: ' + d;
      }
      consumed = Math.max(consumed, index + skip);
    }
    for (let o of base.slice(consumed)) {
      // Add unchanged outputs
      models.push(new OutputDiffModel(o, o));
    }
  } else {
    throw 'Invalid arguments to OutputsDiffModel';
  }
  return models;
}



/**
 * Diff model for a Jupyter Notebook
 */
export class NotebookDiffModel {

  /**
   * Create a new NotebookDiffModel from a base notebook and a list of diffs.
   *
   * The base as well as the diff entries are normally supplied by the nbdime
   * server.
   */
  constructor(base: nbformat.INotebookContent, diff: IDiffEntry[]) {
    // Process global notebook metadata field
    let metaDiff = getDiffKey(diff, 'metadata');
    if (base.metadata && metaDiff) {
      this.metadata = createPatchDiffModel(base.metadata, metaDiff);
    } else {
      this.metadata = null;
    }
    if (this.metadata) {
      this.metadata.collapsible = true;
      this.metadata.collapsibleHeader = 'Notebook metadata changed';
      this.metadata.startCollapsed = true;
    }
    // The notebook metadata MIME type is used for determining the MIME type
    // of source cells, so store it easily accessible:
    try {
      this.mimetype = base.metadata.language_info.mimetype;
    } catch (e) {
      // missing metadata, guess python (probably old notebook)
      this.mimetype = 'text/python';
    }

    // Build cell diff models. Follows similar logic to patching code:
    this.cells = [];
    let take = 0;
    let skip = 0;
    for (let e of getDiffKey(diff, 'cells') || []) {
      let op = e.op;
      let index = e.key as number;

      // diff is sorted on index, so take any preceding cells as unchanged:
      for (let i=take; i < index; i++) {
        this.cells.push(createUnchangedCellDiffModel(
          base.cells[i], this.mimetype));
      }

      // Process according to diff type:
      if (op === DiffOp.SEQINSERT) {
        // One or more inserted/added cells:
        for (let ei of (e as IDiffAddRange).valuelist) {
          this.cells.push(createAddedCellDiffModel(
            ei as nbformat.ICell, this.mimetype));
        }
        skip = 0;
      } else if (op === DiffOp.SEQDELETE) {
        // One or more removed/deleted cells:
        skip = (e as IDiffRemoveRange).length;
        for (let i=index; i < index + skip; i++) {
          this.cells.push(createDeletedCellDiffModel(
            base.cells[i], this.mimetype));
        }
      } else if (op === DiffOp.PATCH) {
        // A cell has changed:
        this.cells.push(createPatchedCellDiffModel(
          base.cells[index], (e as IDiffPatch).diff, this.mimetype));
        skip = 1;
      }

      // Skip the specified number of elements, but never decrement take.
      // Note that take can pass index in diffs with repeated +/- on the
      // same index, i.e. [op_remove(index), op_add(index, value)]
      take = Math.max(take, index + skip);
    }
    // Take unchanged values at end
    for (let i=take; i < base.cells.length; i++) {
      this.cells.push(createUnchangedCellDiffModel(
        base.cells[i], this.mimetype));
    }
  }

  /**
   * Diff model of the notebook's root metadata field
   */
  metadata: IDiffModel;

  /**
   * The default MIME type according to the notebook's root metadata
   */
  mimetype: string;

  /**
   * List of all cell diff models, including unchanged, added/removed and
   * changed cells, in order.
   */
  cells: CellDiffModel[];
}
