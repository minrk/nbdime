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
      let diff = makePatch(0, [makeAddRange(3, 'ghi')]);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be('abcghidef');
      expect(value.additions).to.eql([{from: 3, to: 6, source: null}]);
      expect(value.deletions).to.be.empty();
    });

    it('should patch a simple string deletion', () => {
      let base = 'abcdef';
      let diff = makePatch(0, [makeRemoveRange(2, 2)]);
      let value = patchStringified(base, [diff]);
      expect(value.remote).to.be('abef');
      expect(value.additions).to.be.empty();
      expect(value.deletions).to.eql([{from: 2, to: 4, source: null}]);
    });

    it('should patch a simple string with simple escapes', () => {
      let base = 'a \"string\" with\nsome\tescapable characters';
      let diff = [
        makePatch(1, [
          makeAddRange('some'.length, '\n'),
          makeRemoveRange('some'.length, '\tescapable characters'.length)
        ]),
        makeAddRange(2, ['\tadded escapable characters']),
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
          makePatch(3, [
            makeAddRange(0, 'patched'),
            makeRemoveRange(0, 'valid'.length)
      ])])]);
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

  describe('patch', () => {

    describe('patch object', () => {

      it('should patch an object addition', () => {
        let base = {a: 55, b: 43};
        let diff = [makeAdd('c', 22)];
        let expected = {a: 55, b: 43, c: 22};
        let value = patch(base, diff);
        expect(value).to.eql(expected);
      });

      it('should patch an object removal', () => {
        let base = {a: 55, b: 43};
        let diff = [makeRemove('b')];
        let expected = {a: 55};
        let value = patch(base, diff);
        expect(value).to.eql(expected);
      });

      it('should patch an object replace', () => {
        let base = {a: 55, b: 43};
        let diff = [makeReplace('b', 22)];
        let expected = {a: 55, b: 22};
        let value = patch(base, diff);
        expect(value).to.eql(expected);
      });

      it('should patch an object list-patch', () => {
        let base = {a: 55, b: [43]};
        let diff = [makePatch('b', [makeAddRange(0, [22])])];
        let expected = {a: 55, b: [22, 43]};
        let value = patch(base, diff);
        expect(value).to.eql(expected);
      });

      it('should patch an object object-patch', () => {
        let base = {a: 55, b: {c : 43}};
        let diff = [makePatch('b', [makeReplace('c', 22)])];
        let expected = {a: 55, b: {c: 22}};
        let value = patch(base, diff);
        expect(value).to.eql(expected);
      });

      it('should fail to patch an object with a non-string key', () => {
        let base = {a: 55, b: 43};
        let diff = [makeRemove(32)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch object op: Key is not a string: 32/);
      });

      it('should fail to patch an object with an add on existing key', () => {
        let base = {a: 55, b: 43};
        let diff = [makeAdd('a', 22)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add key diff op: Key already present: a/);
      });

      it('should fail to patch an object with a remove on invalid key', () => {
        let base = {a: 55, b: 43};
        let diff = [makeRemove('c')];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove key diff op: Missing key: c/);
      });

      it('should fail to patch an object with a replace on invalid key', () => {
        let base = {a: 55, b: 43};
        let diff = [makeReplace('c', 22)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid replace key diff op: Missing key: c/);
      });

      it('should fail to patch an object with a patch of an atomic value', () => {
        let base = {a: 55, b: 43};
        let diff = [makePatch('b', [makeAdd('b', 22)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Cannot patch an atomic type: number/);
      });

      it('should fail to patch an object with a patch of an invalid key', () => {
        let base = {a: 55, b: 43};
        let diff = [makePatch('c', [makeReplace('b', 22)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch key diff op: Missing key: c/);
      });

      it('should fail to patch an object with an invalid diff op', () => {
        let base = {a: 55, b: 43};
        let diff = [{op: 'typo', value: 22, key: 'c'}];
        expect(patch).withArgs(base, diff).to.throwException(/Invalid op: typo/);
      });

    });

    describe('patch sequence', () => {

      describe('patch sequence addition', () => {

        it('should patch a sequence addition at start', () => {
          let base = [55, 43];
          let diff = [makeAddRange(0, [22, 33])];
          let expected = [22, 33, 55, 43];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence addition in middle', () => {
          let base = [55, 43];
          let diff = [makeAddRange(1, [22, 33])];
          let expected = [55, 22, 33, 43];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence addition at end', () => {
          let base = [55, 43];
          let diff = [makeAddRange(2, [22, 33])];
          let expected = [55, 43, 22, 33];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });
      });

      describe('patch sequence removal', () => {

        it('should patch a sequence removal at start', () => {
          let base = [55, 43, 22];
          let diff = [makeRemoveRange(0, 2)];
          let expected = [22];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence removal in middle', () => {
          let base = [55, 43, 22, 32];
          let diff = [makeRemoveRange(1, 2)];
          let expected = [55, 32];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence removal at end', () => {
          let base = [55, 43, 22, 32];
          let diff = [makeRemoveRange(2, 2)];
          let expected = [55, 43];
          let value = patch(base, diff);
          expect(value).to.eql(expected);

          diff = [makeRemoveRange(3, 1)];
          expected = [55, 43, 22];
          value = patch(base, diff);
          expect(value).to.eql(expected);
        });

      });

      describe('patch sequence list-patch', () => {

        it('should patch a sequence list-patch at start', () => {
          let base = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
          let diff = [makePatch(0, [makeAddRange(0, [22])])];
          let expected = [[22, 1, 2, 3], [4, 5, 6], [7, 8, 9]];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence list-patch in middle', () => {
          let base = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
          let diff = [makePatch(1, [makeAddRange(0, [22])])];
          let expected = [[1, 2, 3], [22, 4, 5, 6], [7, 8, 9]];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence list-patch at end', () => {
          let base = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
          let diff = [makePatch(2, [makeAddRange(0, [22])])];
          let expected = [[1, 2, 3], [4, 5, 6], [22, 7, 8, 9]];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

      });

      describe('patch sequence object-patch', () => {

        it('should patch a sequence object-patch at start', () => {
          let base = [{a: 32, '15': 33}, {a: 32, '15': 33}, {a: 32, '15': 33}];
          let diff = [makePatch(0, [makeReplace('15', 22)])];
          let expected = [{a: 32, '15': 22}, {a: 32, '15': 33}, {a: 32, '15': 33}];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence object-patch in middle', () => {
          let base = [{a: 32, '15': 33}, {a: 32, '15': 33}, {a: 32, '15': 33}];
          let diff = [makePatch(1, [makeReplace('15', 22)])];
          let expected = [{a: 32, '15': 33}, {a: 32, '15': 22}, {a: 32, '15': 33}];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a sequence object-patch at end', () => {
          let base = [{a: 32, '15': 33}, {a: 32, '15': 33}, {a: 32, '15': 33}];
          let diff = [makePatch(2, [makeReplace('15', 22)])];
          let expected = [{a: 32, '15': 33}, {a: 32, '15': 33}, {a: 32, '15': 22}];
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

      });

      it('should fail to patch a sequence with a non-number key', () => {
        let base = [55, 43];
        // Obvious case
        let diff = [makeRemove('text')];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch sequence op: Key is not a number: text/);

        // Not so obvious case (pure type error, which could be cast correctly)
        diff = [makeRemove('32')];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch sequence op: Key is not a number: 32/);
      });

      it('should fail to patch a sequence with an add on invalid key', () => {
        let base = [55, 43];
        let diff = [makeAddRange(-1, [22])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: -1/);

        diff = [makeAddRange(3, [22])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: 3/);

        diff = [makeAddRange(Infinity, [22])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: Infinity/);

        diff = [makeAddRange(NaN, [22])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: NaN/);
      });

      it('should fail to patch a sequence with a remove on invalid key', () => {
        let base = [55, 43];
        let diff = [makeRemoveRange(-1, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: -1/);

        diff = [makeRemoveRange(2, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: 2/);

        diff = [makeRemoveRange(Infinity, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: Infinity/);

        diff = [makeRemoveRange(NaN, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: NaN/);
      });

      it('should fail to patch a sequence with a too long remove', () => {
        let base = [55, 43];
        let diff = [makeRemoveRange(0, 3)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Range too long!/);

        diff = [makeRemoveRange(1, 2)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Range too long!/);
      });

      it('should fail to patch a sequence with a patch of an atomic value', () => {
        let base = [55, 43];
        let diff = [makePatch(0, [makeAdd('b', 22)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Cannot patch an atomic type: number/);
      });

      it('should fail to patch a sequence with a patch of an invalid key', () => {
        let base = [55, 43];
        let diff = [makePatch(-1, [makeReplace('b', 22)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: -1/);

        diff = [makePatch(2, [makeReplace('b', 22)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: 2/);

        diff = [makePatch(Infinity, [makeReplace('b', 22)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: Infinity/);

        diff = [makePatch(NaN, [makeReplace('b', 22)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: NaN/);
      });

      it('should fail to patch a sequence with an invalid diff op', () => {
        let base = [55, 43];
        let diff = [{op: 'typo', value: 22, key: 0}];
        expect(patch).withArgs(base, diff).to.throwException(/Invalid op: typo/);
      });

    });

    describe('patch string', () => {


      describe('patch string line addition', () => {

        it('should patch a string line addition at start', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makeAddRange(0, ['ij\n'])];
          let expected = 'ij\nabc\ndef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string line addition in middle', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makeAddRange(1, ['ij\n'])];
          let expected = 'abc\nij\ndef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string addition at end', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makeAddRange(3, ['ij\n'])];
          let expected = 'abc\ndef\ngh\nij\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);

          diff = [makeAddRange(3, ['ij'])];
          expected = 'abc\ndef\ngh\nij';
          value = patch(base, diff);
          expect(value).to.eql(expected);
        });
      });

      describe('patch string character addition', () => {

        it('should patch a string character addition at start of first line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(0, [makeAddRange(0, ['ij'])])];
          let expected = 'ijabc\ndef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character addition at end of first line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(0, [makeAddRange('abc'.length, ['ij'])])];
          let expected = 'abcij\ndef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character addition at start of middle line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(1, [makeAddRange(0, ['ij'])])];
          let expected = 'abc\nijdef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character addition at end of middle line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(1, [makeAddRange('def'.length, ['ij'])])];
          let expected = 'abc\ndefij\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character addition in last line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(3, [makeAddRange(0, ['ij'])])];
          let expected = 'abc\ndef\ngh\nij';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

      });

      describe('patch string line removal', () => {

        it('should patch a string line removal at start', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makeRemoveRange(0, 1)];
          let expected = 'def\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string line removal in middle', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makeRemoveRange(1, 1)];
          let expected = 'abc\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string removal at end', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makeRemoveRange(2, 1)];
          let expected = 'abc\ndef\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);

          // Removing line 3 is for now a valid no-op
          // Instead, the diff should say that the newline at end of line 2
          // should be removed! Possibly we could make this explicit by an
          // exception / warning?
        });
      });

      describe('patch string character removal', () => {

        it('should patch a string character removal at start of first line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(0, [makeRemoveRange(1, 2)])];
          let expected = 'a\ndef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character removal at end of first line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(0, [makeRemoveRange(1, 2)])];
          let expected = 'a\ndef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);

          // TODO: Is this really wanted behavior?
          diff = [makePatch(0, [makeRemoveRange(2, 2)])];
          expected = 'abdef\ngh\n';
          value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character removal at start of middle line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(1, [makeRemoveRange(0, 2)])];
          let expected = 'abc\nf\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character removal at end of middle line', () => {
          let base = 'abc\ndef\ngh\n';
          let diff = [makePatch(1, [makeRemoveRange(1, 2)])];
          let expected = 'abc\nd\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

        it('should patch a string character removal in last line', () => {
          let base = 'abc\ndef\ngh\nij';
          let diff = [makePatch(3, [makeRemoveRange(0, 2)])];
          let expected = 'abc\ndef\ngh\n';
          let value = patch(base, diff);
          expect(value).to.eql(expected);
        });

      });

      it('should fail to patch a string with an add on invalid line key', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makeAddRange(-1, ['ij\n'])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: -1/);

        diff = [makeAddRange(5, ['ij\n'])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: 5/);

        diff = [makeAddRange(Infinity, ['ij\n'])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: Infinity/);

        diff = [makeAddRange(NaN, ['ij\n'])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: NaN/);
      });

      it('should fail to patch a string with an add on invalid character key', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makePatch(0, [makeAddRange(-1, ['ij'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: -1/);

        diff = [makePatch(0, [makeAddRange(5, ['ij'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: 5/);

        diff = [makePatch(0, [makeAddRange(Infinity, ['ij'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: Infinity/);

        diff = [makePatch(0, [makeAddRange(NaN, ['ij'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid add range diff op: Key out of range: NaN/);
      });

      it('should fail to patch a string with a remove on invalid line key', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makeRemoveRange(-1, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: -1/);

        diff = [makeRemoveRange(4, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: 4/);

        diff = [makeRemoveRange(Infinity, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: Infinity/);

        diff = [makeRemoveRange(NaN, 1)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: NaN/);
      });

      it('should fail to patch a string with a remove on invalid character key', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makePatch(0, [makeRemoveRange(-1, 1)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: -1/);

        diff = [makePatch(0, [makeRemoveRange(4, 1)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: 4/);

        diff = [makePatch(0, [makeRemoveRange(Infinity, 1)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: Infinity/);

        diff = [makePatch(0, [makeRemoveRange(NaN, 1)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Key out of range: NaN/);
      });

      it('should fail to patch a string with a too long line remove', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makeRemoveRange(0, 5)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Range too long!/);

        diff = [makeRemoveRange(3, 2)];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Range too long!/);
      });

      it('should fail to patch a string with a too long character remove', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makePatch(0, [makeRemoveRange(0, 5)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Range too long!/);

        // TODO: Should this exclude new-line?
        diff = [makePatch(0, [makeRemoveRange(3, 2)])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid remove range diff op: Range too long!/);
      });

      it('should fail to patch a string with a patch of an invalid line key', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makePatch(-1, [makeAddRange(0, ['ij\n'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: -1/);

        diff = [makePatch(4, [makeAddRange(0, ['ij\n'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: 4/);

        diff = [makePatch(Infinity, [makeAddRange(0, ['ij\n'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: Infinity/);

        diff = [makePatch(NaN, [makeAddRange(0, ['ij\n'])])];
        expect(patch).withArgs(base, diff).to.throwException(
          /Invalid patch diff op: Key out of range: NaN/);
      });

      it('should fail to patch a string with an invalid line diff op', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [{op: 'typo', value: 22, key: 0}];
        expect(patch).withArgs(base, diff).to.throwException(/Invalid op: typo/);
      });

      it('should fail to patch a string with an invalid character diff op', () => {
        let base = 'abc\ndef\ngh\n';
        let diff = [makePatch(0, [{op: 'typo', value: 22, key: 0}])];
        expect(patch).withArgs(base, diff).to.throwException(/Invalid op: typo/);
      });

    });

  });

});
