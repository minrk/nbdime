// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

/**
 * Check whether a value is in an array.
 */
export function valueIn(value: any, array: Array<any>) {
  return array.indexOf(value) >= 0;
}


/**
 * Deepcopy routine for JSON-able data types
 */
export function deepCopy(obj) {
  if (typeof obj === 'object') {
    if (obj === null) {
      return null;
    } else if (obj instanceof Array) {
      let l = obj.length;
      let o = new Array(l);
      for (let i = 0; i < l; i++) {
        o[i] = deepCopy(obj[i]);
      }
      return o;
    } else {
      let r: any = {};
      r.prototype = obj.prototype;
      for (let k in obj) {
        r[k] = deepCopy(obj[k]);
      }
      return r;
    }
  }
  return obj;
}

/**
 * Shallow copy routine for objects
 */
export
function shallowCopy(original) {
  // First create an empty object with
  // same prototype of our original source
  let clone = Object.create(Object.getPrototypeOf(original));

  for (let k in original) {
    if (Object.hasOwnProperty('constructor') && original[k].constructor === Function) {
      continue;
    }
    // copy each property into the clone
    Object.defineProperty(clone, k,
      Object.getOwnPropertyDescriptor(original, k)
    );
  }
  return clone;
}

export
function arraysEqual(a: any[], b: any[]) {
  if (a === b) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; ++i) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}


/**
 * Find the shared common starting sequence in two arrays
 */
export
function findSharedPrefix(a: any[], b: any[]): any[] {
  if (a === b) {
    return a.slice();
  }
  if (a === null || b === null) {
    return null;
  }
  let i = 0;
  for (; i < Math.min(a.length, b.length); ++i) {
    if (a[i] !== b[i]) {
      break;
    }
  }
  return a.slice(0, i);
}

/**
 * Check whether `parent` is contained within the start of `sub`
 */
export
function isPrefixArray(parent: any[], sub: any[]): boolean {
  if (parent === sub) {
    return true;
  }
  if (parent === null || parent.length === 0) {
    return true;
  }
  if (sub === null || parent.length > sub.length) {
    return false;
  }
  for (let i = 0; i < parent.length; ++i) {
    if (parent[i] !== sub[i]) {
      return false;
    }
  }
  return true;
}

export
function sortByKey(array, key) {
    return array.sort(function(a, b) {
        let x = a[key]; let y = b[key];
        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}
