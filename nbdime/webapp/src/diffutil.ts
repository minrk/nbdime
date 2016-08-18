// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import * as CodeMirror from 'codemirror';

import {
  valueIn
} from './util';

import {
  ChunkSource
} from './mergedecision';

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
function opAddRange(key: string | number, valuelist: any[]): IDiffAddRange {
  return {op: DiffOp.SEQINSERT, key: key, valuelist: valuelist};
}

/** Create a range removal diff entry */
export
function opRemoveRange(key: string | number, length: number): IDiffRemoveRange {
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
 * Utility function to repeat a string
 */
export function repeatString(str: string, count: number): string {
  if (count < 1) return '';
  var result = '', pattern = str.valueOf();
  while (count > 1) {
    if (count & 1) result += pattern;
    count >>= 1, pattern += pattern;
  }
  return result + pattern;
};

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
export class DiffRangePos {
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
export function raw2Pos(raws: DiffRangeRaw[], text: string): DiffRangePos[] {
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
