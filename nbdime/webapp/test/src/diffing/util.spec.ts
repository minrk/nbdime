// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import expect = require('expect.js');

import * as util from '../../../src/util';

describe('nbdime', () => {

  describe('util', () => {

    describe('arraysEqual', () => {

      it('should return true for instance equality', () => {
        let a = [1, 2, 3];
        let value = util.arraysEqual(a, a);
        expect(value).to.be(true);
      });

      it('should return true for shallow equality', () => {
        let arrays = [[1, 2, 3],
                      ['a', 'b', 'c'],
                      [123, 'text', true]];
        for (let a of arrays) {
          let value = util.arraysEqual(a, a.slice());
          expect(value).to.be(true);
        }
      });

      it('should return true for both null', () => {
        let value = util.arraysEqual(null, null);
        expect(value).to.be(true);
      });

      it('should return false for one null input', () => {
        let a = [1, 2, 3];
        let value = util.arraysEqual(null, a);
        expect(value).to.be(false);

        value = util.arraysEqual(a, null);
        expect(value).to.be(false);
      });

      it('should return false for different length arrays', () => {
        let value = util.arraysEqual([1, 2, 3], [1, 2]);
        expect(value).to.be(false);

        value = util.arraysEqual([1, 2], [1, 2, 3]);
        expect(value).to.be(false);
      });

      it('should return false for deep comparison', () => {
        let value = util.arraysEqual([{a: 1, b: 2}], [{a: 1, b: 2}]);
        expect(value).to.be(false);
      });

    });

    describe('findSharedPrefix', () => {

      it('should return a copy on identical input', () => {
        let a = [1, 2, 3]
        let value = util.findSharedPrefix(a, a);
        expect(value).to.eql(a);
        expect(value).to.not.equal(a);  // Checking for instance equality
      });

      it('should return null for null inputs', () => {
        let value = util.findSharedPrefix(null, null);
        expect(value).to.be(null);

        value = util.findSharedPrefix(null, [1, 2]);
        expect(value).to.be(null);

        value = util.findSharedPrefix([1, 2], null);
        expect(value).to.be(null);
      });

      it('should return empty array for one or more empy inputs', () => {
        let value = util.findSharedPrefix([], []);
        expect(value).to.eql([]);

        value = util.findSharedPrefix([], [1, 2]);
        expect(value).to.eql([]);

        value = util.findSharedPrefix([1, 2], []);
        expect(value).to.eql([]);
      });

      it('should return empty array for disjoint inputs', () => {
        let value = util.findSharedPrefix([1, 2, 3], ['a', 'b', 'c']);
        expect(value).to.eql([]);
      });

      it('should return empty array for inputs that overlap after start', () => {
        let value = util.findSharedPrefix([1, 2, 3, 4], [5, 2, 3, 4]);
        expect(value).to.eql([]);
      });

      it('should find prefix of single element arrays', () => {
        let value = util.findSharedPrefix([1], [1]);
        expect(value).to.eql([1]);

        value = util.findSharedPrefix(['text'], ['text']);
        expect(value).to.eql(['text']);
      });

      it('should find prefix of muliple element arrays that are equal', () => {
        let value = util.findSharedPrefix([1, 2, 3], [1, 2, 3]);
        expect(value).to.eql([1, 2, 3]);

        value = util.findSharedPrefix(['text', 'abc'], ['text', 'abc']);
        expect(value).to.eql(['text', 'abc']);
      });

      it('should find prefix of muliple element arrays that are not equal', () => {
        let value = util.findSharedPrefix([1, 2, 3, 4, 5], [1, 2, 3, 6, 7]);
        expect(value).to.eql([1, 2, 3]);

        value = util.findSharedPrefix(['text', 'abc', 'foo'], ['text', 'abc', 'bar']);
        expect(value).to.eql(['text', 'abc']);
      });

    });

    describe('isPrefixArray', () => {

      it('should return true for object equality', () => {
        let a = [1, 2, 3];
        let value = util.isPrefixArray(a, a);
        expect(value).to.be(true);
      });

      it('should return true for null parent', () => {
        let a = [1, 2, 3];
        let value = util.isPrefixArray(a, a);
        expect(value).to.be(true);
      });

      it('should return true for null parent', () => {
        let value = util.isPrefixArray(null, null);
        expect(value).to.be(true);

        value = util.isPrefixArray(null, [1, 2, 3]);
        expect(value).to.be(true);
      });

      it('should return true for empty parent', () => {
        let value = util.isPrefixArray([], null);
        expect(value).to.be(true);

        value = util.isPrefixArray([], []);
        expect(value).to.be(true);

        value = util.isPrefixArray([], [1, 2, 3]);
        expect(value).to.be(true);
      });

      it('should return false for null child, with non null/empty parent', () => {
        let value = util.isPrefixArray([1], null);
        expect(value).to.be(false);
      });

      it('should return false if child is shorter than parent', () => {
        let value = util.isPrefixArray([1], []);
        expect(value).to.be(false);

        value = util.isPrefixArray([1, 2, 3, 4], [1, 2, 3]);
        expect(value).to.be(false);
      });

      it('should return true if child is equal to parent', () => {
        let value = util.isPrefixArray([1], [1]);
        expect(value).to.be(true);

        value = util.isPrefixArray([1, 2, 3, 4], [1, 2, 3, 4]);
        expect(value).to.be(true);

        value = util.isPrefixArray(['abc', 'def', 0], ['abc', 'def', 0]);
        expect(value).to.be(true);
      });

      it('should return true if entire parent matches start of child', () => {
        let value = util.isPrefixArray([1], [1, 2]);
        expect(value).to.be(true);

        value = util.isPrefixArray([1, 2, 3], [1, 2, 3, 4]);
        expect(value).to.be(true);

        value = util.isPrefixArray(['abc', 'def'], ['abc', 'def', 0]);
        expect(value).to.be(true);
      });

      it('should return false if entire parent matches non-start of child', () => {
        let value = util.isPrefixArray([2], [1, 2]);
        expect(value).to.be(false);

        value = util.isPrefixArray([2, 3, 4], [1, 2, 3, 4]);
        expect(value).to.be(false);

        value = util.isPrefixArray(['def'], ['abc', 'def', 0]);
        expect(value).to.be(false);
      });

    });

    describe('accumulateLengths', () => {

      it('should handle an empty array', () => {
        let value = util.accumulateLengths([]);
        expect(value).to.eql([]);
      });

      it('should handle an single item array', () => {
        let value = util.accumulateLengths(['abc']);
        expect(value).to.eql([3]);
      });

      it('should handle multiple strings', () => {
        let value = util.accumulateLengths(['abc', 'foo', '0xdead']);
        expect(value).to.eql([3, 6, 12]);
      });

      it('should handle multiple strings with newlines at end', () => {
        let value = util.accumulateLengths(['abc\n', 'foo\n', '0xdead\n']);
        expect(value).to.eql([4, 8, 15]);
      });

      it('should handle multiple strings with newlines randomly placed', () => {
        let value = util.accumulateLengths(['\nabc', 'foo\n', '0xde\nad']);
        expect(value).to.eql([4, 8, 15]);
      });

    });

  });

});
