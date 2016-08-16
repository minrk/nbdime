// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import expect = require('expect.js');

import {
  patch, patchStringified
} from '../../../src/patch';

import {
  IDiffEntry, IDiffAdd, IDiffRemove, IDiffReplace,
  IDiffPatch, IDiffAddRange, IDiffRemoveRange, JSON_INDENT, DiffOp
} from '../../../src/diffutil';


function makeAddRange(key: number, values: string | any[]) : IDiffAddRange {
  return {key: key, op: DiffOp.SEQINSERT, valuelist: values, source: null};
}

function makeRemoveRange(key: number, length: number) : IDiffRemoveRange {
  return {key: key, op: DiffOp.SEQDELETE, length: length, source: null};
}

function makeAdd(key: number | string, value: any) : IDiffAdd {
  return {key: key, op: DiffOp.ADD, value: value, source: null};
}

function makeRemove(key: number | string) : IDiffRemove {
  return {key: key, op: DiffOp.REMOVE, source: null};
}

function makeReplace(key: number | string, value: any) : IDiffReplace {
  return {key: key, op: DiffOp.REPLACE, value: value, source: null};
}

function makePatch(key: number | string, diff: IDiffEntry[]) : IDiffPatch {
  return {key: key, op: DiffOp.PATCH, diff: diff, source: null};
}


describe('nbdime', () => {

  describe('patchStringified', () => {

    it('should patch a simple string addition', () => {
      let base = 'abcdef';
      let diff = makeAddRange(3, 'ghi');
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be('abcghidef');
      expect(value.additions).to.eql([{from: 3, to: 6, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch a simple string deletion', () => {
      let base = 'abcdef';
      let diff = makeRemoveRange(2, 2);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be('abef');
      expect(value.additions).to.be.empty();
      expect(value.deletions).to.eql([{from: 2, to: 4, source: null}]);
    });

    it('should patch a simple string with simple escapes', () => {
      let base = 'a \"string\" with\nsome\tescapable characters';
      let diff = [
        makeAddRange('a \"string\" with\nsome'.length,
          '\n\tadded '),
        makeRemoveRange('a \"string\" with\nsome'.length, 1)
      ];
      // Here, level is passed as > 0, which indicates that JSON stringification should be used
      let value = patchStringified(base, diff, 1);
      expect(value.remote).to.be(
        JSON_INDENT + '\"a \\\"string\\\" with\\nsome\\n\\tadded escapable characters\"'
      );
    });

    it('should patch a list addition', () => {
      let base = [1, 2, 3];
      let diff = makeAddRange(2, [-1, -2]);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '[\n' +
        JSON_INDENT + '1,\n' +
        JSON_INDENT + '2,\n' +
        JSON_INDENT + '-1,\n' +
        JSON_INDENT + '-2,\n' +
        JSON_INDENT + '3\n' +
        ']'
      );
      let f = '[\n1,\n2,\n'.length + JSON_INDENT.length * 2;
      let t = f + '-1,\n-2,\n'.length + JSON_INDENT.length * 2;
      expect(value.additions).to.eql([{from: f, to: t, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch a list addition at start', () => {
      let base = [1, 2, 3];
      let diff = makeAddRange(0, [-1, -2]);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '[\n' +
        JSON_INDENT + '-1,\n' +
        JSON_INDENT + '-2,\n' +
        JSON_INDENT + '1,\n' +
        JSON_INDENT + '2,\n' +
        JSON_INDENT + '3\n' +
        ']'
      );
      let f = '[\n'.length;
      let t = f + '-1,\n-2,\n'.length + JSON_INDENT.length * 2;
      expect(value.additions).to.eql([{from: f, to: t, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch a list addition at end', () => {
      let base = [1, 2, 3];
      let diff = makeAddRange(3, [-1, -2]);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '[\n' +
        JSON_INDENT + '1,\n' +
        JSON_INDENT + '2,\n' +
        JSON_INDENT + '3,\n' +
        JSON_INDENT + '-1,\n' +
        JSON_INDENT + '-2\n' +
        ']'
      );
      let f = '[\n1,\n2,\n3,\n'.length + JSON_INDENT.length * 3;
      let t = f + '-1,\n-2\n'.length + JSON_INDENT.length * 2;
      expect(value.additions).to.eql([{from: f, to: t, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch a list deletion', () => {
      let base = [1, 2, 3, 4, 5];
      let diff = makeRemoveRange(2, 2);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '[\n' +
        JSON_INDENT + '1,\n' +
        JSON_INDENT + '2,\n' +
        JSON_INDENT + '5\n' +
        ']'
      );
      let f = '[\n1,\n2,\n'.length + JSON_INDENT.length * 2;
      let t = f + '3,\n4,\n'.length + JSON_INDENT.length * 2;
      expect(value.additions).to.be.empty();
      expect(value.deletions).to.eql([{from: f, to: t, source: null}]);
    });

    it('should patch a list deletion at start', () => {
      let base = [1, 2, 3, 4, 5];
      let diff = makeRemoveRange(0, 2);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '[\n' +
        JSON_INDENT + '3,\n' +
        JSON_INDENT + '4,\n' +
        JSON_INDENT + '5\n' +
        ']'
      );
      let f = '[\n'.length;
      let t = f + '1,\n2,\n'.length + JSON_INDENT.length * 2;
      expect(value.additions).to.be.empty();
      expect(value.deletions).to.eql([{from: f, to: t, source: null}]);
    });

    it('should patch a list deletion at end', () => {
      let base = [1, 2, 3, 4, 5];
      let diff = makeRemoveRange(3, 2);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '[\n' +
        JSON_INDENT + '1,\n' +
        JSON_INDENT + '2,\n' +
        JSON_INDENT + '3\n' +
        ']'
      );
      let f = '[\n1,\n2,\n3\n,'.length + JSON_INDENT.length * 3;
      let t = f + '4,\n5\n'.length + JSON_INDENT.length * 2;
      expect(value.additions).to.be.empty();
      expect(value.deletions).to.eql([{from: f, to: t, source: null}]);
    });

    it('should patch an object addition', () => {
      let base = {a: 1, d: 'test', c: true};
      let diff = makeAdd('b', 42);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '{\n' +
        JSON_INDENT + '\"a\": 1,\n' +
        JSON_INDENT + '\"b\": 42,\n' +
        JSON_INDENT + '\"c\": true,\n' +
        JSON_INDENT + '\"d\": \"test\"\n' +
        '}'
      );
      let f = '{\n\"a\": 1,\n'.length + JSON_INDENT.length;
      let t = f + '\"b\": 42,\n'.length + JSON_INDENT.length;
      expect(value.additions).to.eql([{from: f, to: t, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch an object addition at start', () => {
      let base = {b: 1, d: 'test', c: true};
      let diff = makeAdd('a', 42);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '{\n' +
        JSON_INDENT + '\"a\": 42,\n' +
        JSON_INDENT + '\"b\": 1,\n' +
        JSON_INDENT + '\"c\": true,\n' +
        JSON_INDENT + '\"d\": \"test\"\n' +
        '}'
      );
      let f = '{\n'.length;
      let t = f + '\"a\": 42,\n'.length + JSON_INDENT.length;
      expect(value.additions).to.eql([{from: f, to: t, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch an object addition at end', () => {
      let base = {a: 1, b: 'test', c: true};
      let diff = makeAdd('d', 42);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '{\n' +
        JSON_INDENT + '\"a\": 1,\n' +
        JSON_INDENT + '\"b\": \"test\",\n' +
        JSON_INDENT + '\"c\": true,\n' +
        JSON_INDENT + '\"d\": 42\n' +
        '}'
      );
      let f = '{\n\"a\": 1,\n\"b\": \"test\",\n\"c\": true,\n'.length +
        JSON_INDENT.length * 3;
      let t = f + '\"d\": 42\n'.length + JSON_INDENT.length;
      expect(value.additions).to.eql([{from: f, to: t, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch a nested patch', () => {
      let base = [
        {a: 1, c: true},
        {b: 42, c: 'this\nis\na\nvalid\nstring'}
      ];
      let diff = makePatch(1, [
        makePatch('c', [
          makeAddRange('this\nis\na\n'.length, 'patched'),
          makeRemoveRange('this\nis\na\n'.length, 'valid'.length)
        ])]);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be(
        '[\n' +
        JSON_INDENT + '{\n' +
        JSON_INDENT + JSON_INDENT + '\"a\": 1,\n' +
        JSON_INDENT + JSON_INDENT + '\"c\": true\n' +
        JSON_INDENT + '},\n' +
        JSON_INDENT + '{\n' +
        JSON_INDENT + JSON_INDENT + '\"b\": 42,\n' +
        JSON_INDENT + JSON_INDENT + '\"c\": ' +
          '\"this\\nis\\na\\npatched\\nstring\"\n' +
        JSON_INDENT + '}\n' +
        ']'
      );
      let f = (
          '[\n{\n\"a\": 1,\n' +
          '\"c\": true\n},\n' +
          '{\n\"b\": 42,\n' +
          '\"c\": \"this\\nis\\na\\n'
      ).length + JSON_INDENT.length * 11;
      let t = f + 'patched'.length;
      console.log(value.remote.slice(value.additions[0].from, value.additions[0].to));
      expect(value.additions).to.eql([{from: f, to: t, source: null}]);
      t = f + 'valid'.length;
      expect(value.deletions).to.eql([{from: f, to: t, source: null}]);
    });

  });

});
