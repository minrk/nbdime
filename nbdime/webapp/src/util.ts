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
  if (typeof obj == 'object') {
    if (obj instanceof Array) {
      var l = obj.length;
      var o = new Array(l);
      for (var i = 0; i < l; i++) {
        o[i] = deepCopy(obj[i]);
      }
      return o;
    } else {
      var r: any = {};
      r.prototype = obj.prototype;
      for (var k in obj) {
        r[k] = deepCopy(obj[k]);
      }
      return r;
    }
  }
  return obj;
}