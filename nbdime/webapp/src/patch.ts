// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  valueIn, deepCopy
} from './util';

import {
  DiffRangeRaw, JSON_INDENT, repeatString, IDiffEntry, IDiffAdd, IDiffPatch,
  IDiffAddRange, IDiffRemoveRange, DiffOp
} from './diffutil';


import stableStringify = require('json-stable-stringify');


/**
 * The result of a patch operation of a stringified object.
 *
 * Contains the resulting remote string, as well as ranges describing which
 * parts of the string were changed.
 */
export type StringifiedPatchResult = {
  /**
   * The patched string value
   */
  remote: string,

  /**
   * Position ranges indicating added content, as indices into the remote value
   */
  additions: DiffRangeRaw[],

  /**
   * Position ranges indicating removed content, as indices into the base value
   */
  deletions: DiffRangeRaw[]
};


/**
 * Patch a base JSON object according to diff. Returns the patched object.
 */
export function patch(base: (string | Array<any> | any), diff: IDiffEntry[]) : (string | Array<any> | any) {
  if (typeof base === 'string') {
    return patchString(base, diff, 0, false).remote;
  } else if (base instanceof Array) {
    return patchSequence(base, diff);
  } else {
    return patchObject(base, diff);
  }
}


function patchSequence(base: Array<any>, diff: IDiffEntry[]): Array<any> {
  // The patched sequence to build and return
  let patched = [];
  // Index into obj, the next item to take unless diff says otherwise
  let take = 0;
  let skip = 0;
  for (let e of diff) {
    let op = e.op;
    let index = e.key as number;

    // Take values from base not mentioned in diff, up to not including
    // index
    for (let value of base.slice(take, index)) {
      patched.push(deepCopy(value));
    }

    if (op === DiffOp.SEQINSERT) {
      // Extend with new values directly
      patched = patched.concat(
        (e as IDiffAddRange).valuelist as Array<any>);
      skip = 0;
    } else if (op === DiffOp.SEQDELETE) {
      // Delete a number of values by skipping
      skip = (e as IDiffRemoveRange).length;
    } else if (op === DiffOp.PATCH) {
      patched.push(patch(base[index], (e as IDiffPatch).diff));
      skip = 1;
    } else {
      throw 'Invalid op: ' + op;
    }

    // Skip the specified number of elements, but never decrement take.
    // Note that take can pass index in diffs with repeated +/- on the
    // same index, i.e. [op_remove(index), op_add(index, value)]
    take = Math.max(take, index + skip);
  }

  // Take values at end not mentioned in diff
  for (let value of base.slice(take)) {
    patched.push(deepCopy(value));
  }
  return patched;
}


function patchObject(base: Object, diff: IDiffEntry[]) : Object {
  let patched: any = {};
  let keysToCopy = Object.keys(base);

  if (diff) {
    for (let e of diff) {
      let op = e.op;
      let key = e.key as string;

      if (op === DiffOp.ADD) {
        console.assert(!(key in keysToCopy));
        patched[key] = (e as IDiffAdd).value;
      } else if (op === DiffOp.REMOVE) {
        keysToCopy.splice(keysToCopy.indexOf(key), 1);   // Remove key
      } else if (op === DiffOp.REPLACE) {
        keysToCopy.splice(keysToCopy.indexOf(key), 1);   // Remove key
        patched[key] = (e as IDiffAdd).value;
      } else if (op === DiffOp.PATCH) {
        keysToCopy.splice(keysToCopy.indexOf(key), 1);   // Remove key
        patched[key] = patch(base[key], (e as IDiffPatch).diff);
      } else {
        throw 'Invalid op ' + op;
      }
    }
  }

  // Take items not mentioned in diff
  for (let key of keysToCopy) {
    patched[key] = deepCopy(base[key]);
  }
  return patched;
}

/**
 * Patch a stringified JSON object.
 *
 * Returns the stringified value of the patched JSON object, as well as
 * position ranges indicating which parts of the string that was added or
 * removed.
 *
 * Internally, this builds the ranges based on the actual supplied diff, which
 * can therefore differ from a straigh string-based diff of stringified JSON
 * objects.
 */
export function patchStringified(base: (string | Array<any> | any), diff: IDiffEntry[], level?: number) : StringifiedPatchResult {
  if (level === undefined) {
    level = 0;
  }
  if (typeof base === 'string') {
    // Only stringify if level > 0
    let stringifyPatch = level > 0;
    return patchString(base, diff, level, stringifyPatch);
  } else if (base instanceof Array) {
    return patchStringifiedList(base, diff, level);
  } else {
    return patchStringifiedObject(base, diff, level);
  }
}

function patchStringifiedObject(base: Object, diff: IDiffEntry[], level: number) : StringifiedPatchResult {
  if (level === undefined) {
    var level = 0;
  }
  let map: { [key: string]: any; } = base;
  let remote = '';
  let additions: DiffRangeRaw[] = [];
  let deletions: DiffRangeRaw[] = [];
  let postfix = ',\n';

  let baseIndex = 0;

  // Short-circuit if diff is empty
  if (diff === null || diff === undefined) {
    return {remote: stringify(base, level, true), additions: additions, deletions: deletions};
  }

  // Object is dict. As diff keys should be unique, create map for easy processing
  let ops: { [key: string]: IDiffEntry} = {};
  let opKeys : string[] = [];
  for (let d of diff) {
    opKeys.push(d.key as string);
    ops[d.key as string] = d;
  }
  let allKeys = _getAllKeys(base, opKeys);

  for (; ; ) {
    let key = allKeys.shift();
    if (key === undefined) {
      break;
    }
    let keyString = _makeKeyString(key, level + 1);
    if (valueIn(key, opKeys)) {
      // Entry has a change
      let e = ops[key];
      let op = e.op;

      if (valueIn(op, [DiffOp.ADD, DiffOp.REPLACE, DiffOp.REMOVE])) {
        if (valueIn(op, [DiffOp.ADD, DiffOp.REPLACE])) {
          let valr = stringify((e as IDiffAdd).value, level + 1, false) +
              postfix;
          let length = keyString.length + valr.length;
          if (!_entriesAfter(allKeys, ops, true)) {
            length -= postfix.length - 1; // Newline will still be included
          }
          additions.push(new DiffRangeRaw(remote.length, length, e.source));
          remote += keyString + valr;
        }
        if (valueIn(op, [DiffOp.REMOVE, DiffOp.REPLACE])) {
          let valb = stringify(map[key], level + 1, false) + postfix;
          let length = keyString.length + valb.length;
          if (!_entriesAfter(allKeys, ops, false)) {
            length -= postfix.length - 1; // Newline will still be included
          }
          deletions.push(new DiffRangeRaw(baseIndex, length, e.source));
          baseIndex += valb.length;
        }
      } else if (op === DiffOp.PATCH) {
        let pd = patchStringified(map[key], (e as IDiffPatch).diff, level + 1);
        let valr = pd.remote;
        // Insert key string:
        valr = keyString + valr.slice((level + 1) * JSON_INDENT.length) +
            postfix;
        let offset = remote.length + keyString.length -
            (level + 1) * JSON_INDENT.length;
        _offsetRanges(offset, pd.additions, pd.deletions);
        remote += valr;
        additions = additions.concat(pd.additions);
        deletions = deletions.concat(pd.deletions);

        baseIndex += stringify(map[key], level + 1, false).length +
            keyString.length + postfix.length;
      } else {
        throw 'Invalid op ' + op;
      }
    } else {
      // Entry unchanged
      let val = keyString + stringify(map[key], level + 1, false) + postfix;
      remote += val;
      baseIndex += val.length;
    }
  }

  // Stringify correctly
  if (remote.slice(remote.length - postfix.length) == postfix) {
    remote = remote.slice(0, remote.length - postfix.length);
  }
  let indent = repeatString(JSON_INDENT, level);
  remote = indent + '{\n' + remote + '\n' + indent + '}';
  _offsetRanges(indent.length + 2, additions, deletions);
  return {remote: remote, additions: additions, deletions: deletions};
}

function patchStringifiedList(base: Array<any>, diff: IDiffEntry[], level: number) : StringifiedPatchResult {
  let remote = '';
  let additions: DiffRangeRaw[] = [];
  let deletions: DiffRangeRaw[] = [];
  let baseIndex = 0;  // Position in base string
  let postfix = ',\n';

  // Short-circuit if diff is empty
  if (diff === null || diff === undefined) {
    return {remote: stringify(base, level),
            additions: additions,
            deletions: deletions};
  }
  // Index into obj, the next item to take unless diff says otherwise
  let take = 0;
  let skip = 0;
  for (let e of diff) {
    let op = e.op;
    let index = e.key as number;

    // Take values from obj not mentioned in diff, up to not including index
    for (; index > take; take++) {
      let unchanged = stringify(base[take], level + 1) + postfix;
      remote += unchanged;
      baseIndex += unchanged.length;
    }

    if (op === DiffOp.SEQINSERT) {
      // Extend with new values directly
      let val = '';
      for (let v of (e as IDiffAddRange).valuelist) {
        val += stringify(v, level + 1) + postfix;
      }
      let difflen = val.length;
      if (index === base.length) {
        difflen -= 1; // No comma if at end
      }
      additions.push(new DiffRangeRaw(remote.length, difflen, e.source));
      remote += val;
      skip = 0;
    } else if (op === DiffOp.SEQDELETE) {
      // Delete a number of values by skipping
      let val = '';
      let len = (e as IDiffRemoveRange).length;
      for (let i = 0; i < len; i++) {
        val += stringify(base[i], level + 1) + postfix;
      }
      let difflen = val.length;
      if (len + index === base.length) {
        difflen -= 1; // No comma if at end
      }
      deletions.push(new DiffRangeRaw(baseIndex, difflen, e.source));
      baseIndex += val.length;
      skip = (e as IDiffRemoveRange).length;
    } else if (op === DiffOp.PATCH) {
      let pd = patchStringified(base[index], (e as IDiffPatch).diff, level + 1);
      skip = 1;

      let val = pd.remote + postfix;
      _offsetRanges(remote.length, pd.additions, pd.deletions);
      additions = additions.concat(pd.additions);
      deletions = deletions.concat(pd.deletions);
      baseIndex += stringify(base[index], level + 1).length;
      remote += val;
    }

    // Skip the specified number of elements, but never decrement take.
    // Note that take can pass index in diffs with repeated +/- on the
    // same index, i.e. [op_remove(index), op_add(index, value)]
    take = Math.max(take, index + skip);
  }

  // Take unchanged values at end
  for (; base.length > take; take++) {
    remote += stringify(base[take], level + 1) + postfix;
  }

  // Stringify correctly
  if (remote.slice(remote.length - postfix.length) == postfix) {
    remote = remote.slice(0, remote.length - postfix.length);
  }
  let indent = repeatString(JSON_INDENT, level);
  remote = indent + '[\n' + remote + '\n' + indent + ']';
  _offsetRanges(indent.length + 2, additions, deletions);
  return {remote: remote, additions: additions, deletions: deletions};
}

function patchString(base: string, diff: IDiffEntry[], level: number, stringifyPatch?: boolean) : StringifiedPatchResult {
  let additions: DiffRangeRaw[] = [];
  let deletions: DiffRangeRaw[] = [];
  let baseIndex= 0;

  // Short-circuit if diff is empty
  if (diff === null || diff === undefined) {
    return {remote: stringify(base, level),
            additions: additions,
            deletions: deletions};
  }
  // Index into obj, the next item to take unless diff says otherwise
  let take = 0;
  let skip = 0;
  let remote = '';
  for (let e of diff) {
    let op = e.op;
    let index = e.key as number;

    // Take values from obj not mentioned in diff, up to not including index
    let unchanged = base.slice(take, index);
    remote += unchanged;
    baseIndex += unchanged.length;

    if (op === DiffOp.SEQINSERT) {
      let added = (e as IDiffAddRange).valuelist;
      additions.push(new DiffRangeRaw(remote.length, added.length, e.source));
      remote += added;
      skip = 0;
    } else if (op === DiffOp.SEQDELETE) {
      // Delete a number of values by skipping
      skip = (e as IDiffRemoveRange).length;
      deletions.push(new DiffRangeRaw(baseIndex, skip, e.source));
      baseIndex += skip;
    } else {
      throw 'Invalid diff op on string: ' + op;
    }
    take = Math.max(take, index + skip);
  }
  remote += base.slice(take, base.length);
  if (stringifyPatch) {
    // The remote string should be stringified
    remote = stringify(remote, level);
    // Shift all indices by indentation + one to account for opening quote
    _offsetRanges(level * JSON_INDENT.length + 1, additions, deletions);
    // Offset ranges by JSON escaping
    _adjustRangesByJSONEscapes(remote, additions);
    _adjustRangesByJSONEscapes(stringify(base, level), deletions);
  }
  return {remote: remote, additions: additions, deletions: deletions};
}

/**
 * Ordered stringify. Wraps stableStringify(), but handles indentation, and
 * turns null input into empty string.
 */
export function stringify(values: string | any[] | { [key: string] : any},
                          level?: number, indentFirst?: boolean) : string {
  let ret = (values === null) ? '' : stableStringify(values, {space: JSON_INDENT});
  if (level) {
    ret = _indent(ret, level, indentFirst);
  }
  return ret;
}


// Utility functions and variables:

/**
 * Function that checks whether any dict entries will remain after
 * applying the given ops.
 */
function _entriesAfter(remainingKeys: string[], ops: { [key: string]: IDiffEntry},
                       isAddition?: boolean): boolean {
  let cop = isAddition !== false ? DiffOp.REMOVE : DiffOp.ADD;
  for (let key of remainingKeys) {
    if (!(key in ops) || ops[key].op !== cop) {
      return true;
    }
  }
  return false;
}

/**
 * Indent a (multiline) string with `JSON_INDENT` given number of times.
 *
 * indentFirst controls whether the first line is indented as well, and
 * defaults to true.
 */
function _indent(str: string, levels: number, indentFirst?: boolean) : string {
  indentFirst = indentFirst !== false;
  let lines = str.split('\n');
  let ret: string[] = new Array(lines.length);
  if (!indentFirst) {
    ret[0] = lines[0];
  }
  for (let i = indentFirst ? 0 : 1; i < lines.length; i++) {
    ret[i] = repeatString(JSON_INDENT, levels) + lines[i];
  }
  return ret.join('\n');
}

/**
 * The keys present in a Object class. Equivalent to Object.keys, but with a
 * fallback if not defined.
 */
let _objectKeys = Object.keys || function (obj) {
  let has = Object.prototype.hasOwnProperty || function () { return true; };
  let keys: any[] = [];
  for (let key in obj) {
    if (has.call(obj, key)) {
      keys.push(key);
    }
  }
  return keys;
};

/** Filter function for _getAllKeys */
function _onlyUnique(value: any, index: any, self: any) {
  return self.indexOf(value) === index;
}

/**
 * Get all unique keys that are either in `obj`, `diffKeys` or both.
 * Returned as a sorted list.
 */
function _getAllKeys(obj: Object, diffKeys: string[]) {
  return _objectKeys(obj).concat(diffKeys).filter(_onlyUnique).sort();
}

/** Make a string for a stringified dict key, with indentation */
function _makeKeyString(key: string, level: number) {
  return repeatString(JSON_INDENT, level) + '"' + key + '": ';
}

/** Shift all positions in given ranges by same amount */
function _offsetRanges(offset: number, additions: DiffRangeRaw[], deletions: DiffRangeRaw[]) {
  for (let a of additions) {
    a.offset(offset);
  }
  for (let d of deletions) {
    d.offset(offset);
  }
}

/**
 * Adjust diff ranges to compensate for increased length occupied by characters
 * escaped during JSON stringification.
 */
function _adjustRangesByJSONEscapes(jsonString: string, ranges: DiffRangeRaw[]) {
  // First find all escaped characters, and expansion coefficients
  let simpleEscapes = [
      '\\\"', '\\\\', '\\/', '\\b', '\\f', '\\n', '\\r', '\\t'];
  let surrogateUnicodes = /\\uD[89A-Fa-f][0-9a-fA-F]{2}\\uD[c-fC-F][0-9a-fA-F]{2}/g;
  // Look for unicodes that are not part of a surrogate:
  let unicodes = /(?!\\uD[c-fC-F][0-9a-fA-F]{2})\\u(?!D[89A-Fa-f][0-9a-fA-F]{2})\d{4}/g;
  const SIMPLE_ESCAPE_LENGTH = 2;
  const UNICODE_ESCAPE_LENGTH = 6;
  const SURROGATE_ESCAPE_LENGTH = 12;

  // Equal sized arrays identifying location and expansion
  // factor of each escaped character:
  let indices: number[] = [];
  let expansions: number[] = [];


  for (let e of simpleEscapes) {
    let len = JSON.parse('"' + e + '"').length as number;
    let i = 0;
    while (1) {
      i = jsonString.indexOf(e, i);
      if (i < 0) {
        break;
      }
      indices.push(i);
      expansions.push(SIMPLE_ESCAPE_LENGTH - len);
      i++;
    }
  }
  let match: RegExpExecArray;
  while ((match = unicodes.exec(jsonString)) !== null) {
    indices.push(match.index);
    expansions.push(
      UNICODE_ESCAPE_LENGTH -
      JSON.parse('"' + match[0] + '"').length);
  }
  while ((match = surrogateUnicodes.exec(jsonString)) !== null) {
    indices.push(match.index);
    expansions.push(
      SURROGATE_ESCAPE_LENGTH -
      JSON.parse('"' + match[0] + '"').length);
  }

  // Now adjust differences
  // TODO: Optimize this algorithm?
  for (let i = 0; i < indices.length; i++) {
    for (let r of ranges) {
      let idx = indices[i];
      let exp = expansions[i];
      if (r.from > idx) {
        r.from += exp;
      }
      if (r.to > idx) {
        r.to += exp;
      }
    }
  }
}
