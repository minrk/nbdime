// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import * as CodeMirror from 'codemirror';

import {
  valueIn, sortByKey, shallowCopy, accumulateLengths
} from './util';

import {
  ChunkSource
} from './chunking';

/**
 * The indentation to use for JSON stringify.
 */
export const JSON_INDENT = '  ';


/**
 * The different diff operations available
 */
export
namespace DiffOp {
  /**
   * An added object entry
   */
  export const ADD = 'add';

  /**
   * A removed object entry
   */
  export const REMOVE = 'remove';

  /**
   * A replaced object entry
   */
  export const REPLACE = 'replace';

  /**
   * A patched entry (object entry or list entry)
   */
  export const PATCH = 'patch';

  /**
   * An added sequence of list entries, or an added substring
   */
  export const SEQINSERT = 'addrange';

  /**
   * A removed sequence of list entries, or a removed substring
   */
  export const SEQDELETE = 'removerange';
}


/**
 * Base class for all diff entries
 */
export interface IDiffEntryBase {
  /**
   * The key of the diff entry: Either the field name in an object, or the
   * index in a list/string.
   */
  key: string | number;

  /**
   * A string identifying the diff operation type, as defined by DiffOp.
   */
  op: string;

  /**
   * Optional: Source of diff, for use when merging.
   *
   * This should not need to be set manually.
   */
  source?: ChunkSource;
}


/**
 * Diff representing an added sequence of list entries, or an added substring
 */
export interface IDiffAddRange extends IDiffEntryBase {
  key: number;
  /**
   * The sequence of values that were added
   */
  valuelist: string | any[];
}

/**
 * Diff representing an added object entry
 */
export interface IDiffAdd extends IDiffEntryBase {
  /**
   * The value that was added
   */
  value: any;
}


/**
 * Diff representing a removed object entry
 */
export interface IDiffRemove extends IDiffEntryBase {
  // No extra info needed
}


/**
 * Diff representing a replaced object entry
 */
export interface IDiffReplace extends IDiffEntryBase {
  /**
   * The new value
   */
  value: any;
}


/**
 * Diff representing a removed sequence of list entries, or a removed substring
 */
export interface IDiffRemoveRange extends IDiffEntryBase {
  key: number;

  /**
   * The length of the sequence that was deleted
   */
  length: number;
}


/**
 * Diff representing a patched entry (object entry or list entry)
 */
export interface IDiffPatch extends IDiffEntryBase {
  /**
   * The collection of sub-diffs describing the patch of the object
   */
  diff: IDiffEntry[];
}

/**
 * Describes a diff entry of a single JSON value (object, list, string)
 */
export type IDiffEntry = (IDiffAddRange | IDiffRemoveRange | IDiffPatch | IDiffAdd | IDiffRemove | IDiffReplace);

/** Create a replacement diff entry */
export
function opReplace(key: string | number, value: any): IDiffReplace {
  return {op: DiffOp.REPLACE, key: key, value: value};
}

/** Create an addition diff entry */
export
function opAdd(key: string | number, value: any): IDiffAdd {
  return {op: DiffOp.ADD, key: key, value: value};
}

/** Create a removal diff entry */
export
function opRemove(key: string | number): IDiffRemove {
  return {op: DiffOp.REMOVE, key: key};
}

/** Create a removal diff entry */
export
function opAddRange(key: number, valuelist: string | any[]): IDiffAddRange {
  return {op: DiffOp.SEQINSERT, key: key, valuelist: valuelist};
}

/** Create a range removal diff entry */
export
function opRemoveRange(key: number, length: number): IDiffRemoveRange {
  return {op: DiffOp.SEQDELETE, key: key, length: length};
}

/** Create a range removal diff entry */
export
function opPatch(key: string | number, diff: IDiffEntry[]): IDiffPatch {
  return {op: DiffOp.PATCH, key: key, diff: diff};
}


/**
 * Search the list of diffs for an entry with the given key.
 *
 * Returns the first found entry, or null if not entry was found.
 */
export function getDiffKey(diff: IDiffEntry[], key: string | number) : IDiffEntry[] {
  for (let i=0; i < diff.length; ++i) {
    if (diff[i].key === key) {
      return (diff[i] as IDiffPatch).diff;
    }
  }
  return null;
}

/**
 * Represents a range in a diff (typically in a string), in absolute indices (1D)
 */
export class DiffRangeRaw {
  /**
   * Create a new range [from, to = from + length)
   */
  constructor(from: number, length: number, source: ChunkSource) {
    this.from = from;
    this.to = from + length;
    this.source = source;
  }

  /**
   * Change both `from` and `to` fields by the given offset
   */
  offset(offset: number) {
    this.from += offset;
    this.to += offset;
  }

  /**
   * The starting index of the range.
   */
  from: number;

  /**
   * The final index of the range (non-inclusive, compatible with .slice())
   */
  to: number;

  /**
   * Diff source for merging
   */
  source: ChunkSource;
}

/**
 * Class representing a string (diff) range in the format of
 * CodeMirror.Positions. Mainly makes sense for string diffs.
 *
 * The class also has fields to ease chunking of diffs without reparsing the
 * text.
 */
export
class DiffRangePos {
  /**
   * Create a diff range. The `ch` field of the `to` position is defined as
   * non-inclusive, i.e., it follows the syntax of String.slice().
   */
  constructor(
        public from: CodeMirror.Position,
        public to: CodeMirror.Position,
        chunkStartLine?: boolean,
        endsOnNewline?: boolean) {
    this.chunkStartLine = chunkStartLine === true;
    this.endsOnNewline = endsOnNewline === true;
  }

  /**
   * Whether to include the first line of the range (from.line) when chunking.
   * If false, from.line + 1 should be used instead.
   *
   * Typically used when the diff starts with a newline.
   */
  chunkStartLine: boolean;

  /**
   * Whether the diff represented by the range ends on a newline.
   */
  endsOnNewline: boolean;

  /**
   * Diff source for merging
   */
  source: ChunkSource;
}


/**
 * Utility function to find the line number of a given string index,
 * given the positions of all newlines.
 */
function findLineNumber(nlPos: number[], index: number): number {
  if (nlPos.length === 0) {
    return 0;
  }
  let lineNo: number = null;
  nlPos.some(function(el, i) {
    if (el >= index) {
      lineNo = i;
      return true;
    }
    return false;
  });
  if (lineNo === null) {
    return nlPos.length;
  }
  return lineNo;
}

/**
 * Function to convert an array of DiffRangeRaw to DiffRangePos. The
 * `text` parameter is the text in which the ranges exist.
 */
export
function raw2Pos(raws: DiffRangeRaw[], text: string): DiffRangePos[] {
  // Find all newline's indices in text
  let adIdx: number[] = [];
  let i = -1;
  while (-1 !== (i = text.indexOf('\n', i + 1))) {
    adIdx.push(i);
  }
  let result: DiffRangePos[] = [];
  // Find line numbers from raw index
  for (let r of raws) {
    // First `from` position:
    let line = findLineNumber(adIdx, r.from);
    let lineStartIdx = line > 0 ? adIdx[line - 1] + 1 : 0;
    let from = CodeMirror.Pos(line, r.from - lineStartIdx);

    // Then `to` position:
    line = findLineNumber(adIdx, r.to - 1);  // `to` is non-inclusive
    lineStartIdx = line > 0 ? adIdx[line - 1] + 1 : 0;
    let to = CodeMirror.Pos(line, r.to - lineStartIdx);

    // Finally chunking hints:
    let startsOnNewLine = valueIn(r.from, adIdx);
    let endsOnNewline = valueIn(r.to - 1, adIdx);  // non-inclusive
    let firstLineNew = from.ch === 0 && (
      from.line !== to.line || endsOnNewline || r.to === text.length);
    let chunkFirstLine = (
      firstLineNew ||
      !startsOnNewLine ||
      (
        // Neither preceding nor following character is a newline
        !valueIn(r.from - 1, adIdx) &&
        !valueIn(r.to, adIdx)
      )
    );
    let pos = new DiffRangePos(from, to, chunkFirstLine, endsOnNewline);
    pos.source = r.source;
    result.push(pos);
  }
  return result;
}


/**
 * Validate that a diff operation is valid to apply on a given base sequence
 */
export
function validateSequenceOp(base: Array<any> | string, entry: IDiffEntry): void {
  let op = entry.op;
  if (typeof entry.key !== 'number') {
      throw 'Invalid patch sequence op: Key is not a number: ' + entry.key;
  }
  let index = entry.key as number;
  if (op === DiffOp.SEQINSERT) {
    if (index < 0 || index > base.length || isNaN(index)) {
      throw 'Invalid add range diff op: Key out of range: ' + index;
    }
  } else if (op === DiffOp.SEQDELETE) {
    if (index < 0 || index >= base.length || isNaN(index)) {
      throw 'Invalid remove range diff op: Key out of range: ' + index;
    }
    let skip = (entry as IDiffRemoveRange).length;
    if (index + skip > base.length || isNaN(index)) {
      throw 'Invalid remove range diff op: Range too long!';
    }
  } else if (op === DiffOp.PATCH) {
    if (index < 0 || index >= base.length || isNaN(index)) {
      throw 'Invalid patch diff op: Key out of range: ' + index;
    }
  } else {
    throw 'Invalid op: ' + op;
  }
}


/**
 * Validate that a diff operation is valid to apply on a given base object
 */
export
function validateObjectOp(base: Object, entry: IDiffEntry, keys: string[]): void {
  let op = entry.op;
  if (typeof entry.key !== 'string') {
      throw 'Invalid patch object op: Key is not a string: ' + entry.key;
  }
  let key = entry.key as string;

  if (op === DiffOp.ADD) {
    if (valueIn(key, keys)) {
      throw 'Invalid add key diff op: Key already present: ' + key;
    }
  } else if (op === DiffOp.REMOVE) {
    if (!valueIn(key, keys)) {
      throw 'Invalid remove key diff op: Missing key: ' + key;
    }
  } else if (op === DiffOp.REPLACE) {
    if (!valueIn(key, keys)) {
      throw 'Invalid replace key diff op: Missing key: ' + key;
    }
  } else if (op === DiffOp.PATCH) {
    if (!valueIn(key, keys)) {
      throw 'Invalid patch key diff op: Missing key: ' + key;
    }
  } else {
    throw 'Invalid op: ' + op;
  }
}

let addops = [DiffOp.ADD, DiffOp.SEQINSERT];

/**
 * Check whether existing collection of diff ops shares a key with the new
 * diffop, and if they  also have the same op type.
 */
function overlaps(existing: IDiffEntry[], newv: IDiffEntry): boolean {
  if (existing.length < 1) {
    return false;
  }
  for (let e of existing) {
    if (e.op === newv.op) {
      if (e.key === newv.key) {
        // Found a match
        return true;
      } else if (e.op === DiffOp.SEQDELETE) {
        let r = e as IDiffRemoveRange;
        let first = r.key < newv.key ? r : newv as IDiffRemoveRange;
        let last = r.key > newv.key ? r : newv as IDiffRemoveRange;
        if (first.key + first.length >= last.key) {
          // Overlapping deletes
          // Above check is open ended to allow for sanity check here:
          if (first.key + first.length !== last.key) {
            throw 'Overlapping delete diff ops: ' +
              'Two operation remove same characters!';
          }
          return true;
        }
      }
    } else if (valueIn(e.op, addops) && valueIn(newv.op, addops) &&
              e.key === newv.key) {
      // Addrange and single add can both point to same key
      return true;
    }
  }
  return false;
}


/**
 * Combines two ops into a new one that does the same
 */
function combineOps(a: IDiffEntry, b: IDiffEntry): IDiffEntry {
  if (valueIn(b.op, addops)) {
    let aTyped: IDiffAddRange = null;
    if (a.op === DiffOp.ADD) {
      aTyped = opAddRange(a.key as number, [(a as IDiffAdd).value]);
    } else {
      aTyped = opAddRange(a.key as number, (a as IDiffAddRange).valuelist);
    }
    if (b.op === DiffOp.SEQINSERT) {
      let bTyped = b as IDiffAddRange;
      // valuelist can also be string, but string also has concat:
      (aTyped.valuelist as any[]).concat(bTyped.valuelist as any[]);
    } else {
      let bTyped = b as IDiffAdd;
      if (typeof aTyped.valuelist === 'string') {
        aTyped.valuelist += bTyped.value;
      } else {
        (aTyped.valuelist as any[]).push(bTyped.value);
      }
    }
    return aTyped;
  } else if (b.op === DiffOp.SEQDELETE) {
    if (a.op !== DiffOp.SEQDELETE) {
      throw 'Cannot combine operations: ' + a + ', ' + b;
    }
    let aTyped = a as IDiffRemoveRange;
    let bTyped = b as IDiffRemoveRange;
    return opRemoveRange(aTyped.key, aTyped.length + bTyped.length);
  }
}


function validateStringDiff(base: string[], entry: IDiffEntry, lineToChar: number[]): void {
  // First valdiate line ops:
  validateSequenceOp(base, entry);

  if (entry.op === DiffOp.PATCH) {
    let line = base[entry.key as number];
    let diff = (entry as IDiffPatch).diff;
    for (let d of diff) {
      validateSequenceOp(line, d);
    }
  }
}


/**
 * Translates a diff of strings split by str.splitlines() to a diff of the
 * joined multiline string
 */
export
function flattenStringDiff(val: string[] | string, diff: IDiffEntry[]): IDiffEntry[] {

  if (typeof val === 'string') {
    // Split lines (retaining newlines):
    val = (val as string).match(/^.*([\n\r]|$)/gm);
  }
  let a = val as string[];
  let lineToChar = [0].concat(accumulateLengths(a));
  let flattened: IDiffEntry[] = [];
  for (let e of diff) {
    // Frist validate op:
    validateStringDiff(a, e, lineToChar);
    let op = e.op;
    let lineOffset = lineToChar[e.key];
    if (op === DiffOp.PATCH) {
      for (let p of (e as IDiffPatch).diff) {
        let d = shallowCopy(p);
        d.key += lineOffset;
        if (overlaps(flattened, d)) {
          flattened[-1] = combineOps(flattened[-1], d);
        } else {
          flattened.push(d);
        }
      }
    } else {
      // Other ops simply have keys which refer to lines
      let d: IDiffEntry = null;
      if (op === DiffOp.SEQINSERT) {
        let et = e as IDiffAddRange;
        d = opAddRange(lineOffset,
                       (et.valuelist as any[]).join(''));
      } else if (op === DiffOp.SEQDELETE) {
        let et = e as IDiffRemoveRange;
        let idx = et.key + et.length;
        d = opRemoveRange(lineOffset,
                          lineToChar[idx] - lineOffset);
      }

      if (overlaps(flattened, d)) {
        flattened[-1] = combineOps(flattened[-1], d);
      } else {
        flattened.push(d);
      }
    }
  }
  // Finally, sort on key (leaving equal items in original order)
  // This is done since the original diffs are sorted deeper first!
  return sortByKey(flattened, 'key');
}
