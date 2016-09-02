// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import expect = require('expect.js');

import * as decisions from '../../../src/mergedecision';

import {
  opAdd, opPatch, IDiffEntry, IDiffPatch
} from '../../../src/diffutil';

import {
  arraysEqual
} from '../../../src/util';


describe('nbdime', () => {

  describe('decisions', () => {

    describe('MergeDecision class', () => {

      let jsonStructure: decisions.IMergeDecision = {
          action: 'custom',
          local_diff: [opAdd(2, 22)],
          remote_diff: [opAdd(2, 33)],
          custom_diff: [opAdd(2, 55)],
          conflict: true,
          common_path: ['a', 0, '32', 'foo', 'bar']
        };

      it('should initialize by full JSON structure', () => {
        let value = new decisions.MergeDecision(jsonStructure);
        expect(value.action).to.equal(jsonStructure.action);
        expect(value.localDiff).to.eql(jsonStructure.local_diff);
        expect(value.remoteDiff).to.eql(jsonStructure.remote_diff);
        expect(value.customDiff).to.eql(jsonStructure.custom_diff);
        expect(value.conflict).to.equal(jsonStructure.conflict);
        expect(value.absolutePath).to.eql(jsonStructure.common_path);
      });

      it('should serialize out a JSON structure', () => {
        let d = new decisions.MergeDecision(
          jsonStructure.common_path,
          jsonStructure.local_diff,
          jsonStructure.remote_diff,
          jsonStructure.action as decisions.Action,
          jsonStructure.conflict,
          jsonStructure.custom_diff
        );
        let value = d.serialize();
        expect(value).to.eql(jsonStructure);
      });

      it('should recreate a JSON structure from constructor/serialize', () => {
        let value = new decisions.MergeDecision(jsonStructure).serialize();
        expect(value).to.eql(jsonStructure);
      });

      it('should initialize to defaults by partial JSON structure', () => {
        // Check everything in one go with empty structure:
        let s: decisions.IMergeDecision = { };
        let value = new decisions.MergeDecision(s);
        expect(value.action).to.equal('base');
        expect(value.localDiff).to.equal(null);
        expect(value.remoteDiff).to.equal(null);
        expect(value.customDiff).to.equal(null);
        expect(value.conflict).to.equal(false);
        expect(value.absolutePath).to.eql([]);
      });

      it('should initialize by copy constructor', () => {
        // Check everything in one go with empty structure:
        let initial = new decisions.MergeDecision(jsonStructure);
        let value = new decisions.MergeDecision(initial);
        expect(value.action).to.equal(jsonStructure.action);
        expect(value.localDiff).to.eql(jsonStructure.local_diff);
        expect(value.remoteDiff).to.eql(jsonStructure.remote_diff);
        expect(value.customDiff).to.eql(jsonStructure.custom_diff);
        expect(value.conflict).to.equal(jsonStructure.conflict);
        expect(value.absolutePath).to.eql(jsonStructure.common_path);
      });

      it('should slice localPath to level', () => {
        let value = new decisions.MergeDecision(jsonStructure);
        expect(value.localPath).to.eql(jsonStructure.common_path);

        for (let i = 0; i <= jsonStructure.common_path.length; ++i) {
          value.level = i;
          expect(value.localPath).to.eql(jsonStructure.common_path.slice(i));
        }
      });

      it('should be able to push a path', () => {
        let value = new decisions.MergeDecision(jsonStructure);

        value.pushPath('test');
        expect(value.absolutePath).to.eql(['a', 0, '32', 'foo', 'bar', 'test']);
      });

    });

    describe('popPath', () => {

      it('should always pop patch paths if only passed one diff', () => {
        let diffs: IDiffEntry[][] = [[opPatch('a', [opPatch(0, [opPatch('foo',
          [opAdd(32, 'bar')])])])]];
        let value = decisions.popPath(diffs);
        expect(value.key).to.be('a');
        expect(value.diffs.length).to.be(1);
        expect(value.diffs[0]).to.equal((diffs[0][0] as IDiffPatch).diff);

        diffs = [(diffs[0][0] as IDiffPatch).diff];
        value = decisions.popPath(diffs);
        expect(value.key).to.be(0);
        expect(value.diffs.length).to.be(1);
        expect(value.diffs[0]).to.equal((diffs[0][0] as IDiffPatch).diff);

        diffs = [(diffs[0][0] as IDiffPatch).diff];
        value = decisions.popPath(diffs);
        expect(value.key).to.be('foo');
        expect(value.diffs.length).to.be(1);
        expect(value.diffs[0]).to.equal((diffs[0][0] as IDiffPatch).diff);
      });

      it('should pop shared patch paths', () => {
        let diffs: IDiffEntry[][] = [
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])],
          [opPatch('a', [opPatch(0, [opAdd(2, 'whizz')])])]
        ];
        let value = decisions.popPath(diffs);
        expect(value.key).to.be('a');
        expect(value.diffs.length).to.be(2);
        expect(value.diffs[0]).to.equal((diffs[0][0] as IDiffPatch).diff);
        expect(value.diffs[1]).to.equal((diffs[1][0] as IDiffPatch).diff);

        diffs = [(diffs[0][0] as IDiffPatch).diff,
                 (diffs[1][0] as IDiffPatch).diff];
        value = decisions.popPath(diffs);
        expect(value.key).to.be(0);
        expect(value.diffs.length).to.be(2);
        expect(value.diffs[0]).to.equal((diffs[0][0] as IDiffPatch).diff);
        expect(value.diffs[1]).to.equal((diffs[1][0] as IDiffPatch).diff);
      });

      it('should pop patch path if one entry is null', () => {
        let diffs: IDiffEntry[][] = [
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])],
          null
        ];
        let value = decisions.popPath(diffs);
        expect(value.key).to.be('a');
        expect(value.diffs.length).to.be(2);
        expect(value.diffs[0]).to.equal((diffs[0][0] as IDiffPatch).diff);
        expect(value.diffs[1]).to.equal(null);

        // Check there is no preference for order:
        diffs = [
          null,
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])]
        ];
        value = decisions.popPath(diffs);
        expect(value.key).to.be('a');
        expect(value.diffs.length).to.be(2);
        expect(value.diffs[0]).to.equal(null);
        expect(value.diffs[1]).to.equal((diffs[1][0] as IDiffPatch).diff);
      });

      it('should NOT pop patch path if only one side has patch', () => {
        let diffs: IDiffEntry[][] = [
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])],
          [opAdd('b', 'bar')]
        ];
        let value = decisions.popPath(diffs);
        expect(value).to.be(null);
      });

      it('should NOT pop patch path if only one side has multiple entries', () => {
        let diffs: IDiffEntry[][] = [
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])],
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])]), opAdd('b', 'bar')]
        ];
        let value = decisions.popPath(diffs);
        expect(value).to.be(null);

        diffs = [
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])],
          [opAdd('b', 'bar'), opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])]
        ];
        value = decisions.popPath(diffs);
        expect(value).to.be(null);
      });

      it('should NOT pop path if both sides has multiple entries', () => {
        let diffs: IDiffEntry[][] = [
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])]), opAdd('b', 'bar')],
          [opPatch('a', [opPatch(0, [opAdd(32, 'bar')])]), opAdd('b', 'bar')]
        ];
        let value = decisions.popPath(diffs);
        expect(value).to.be(null);

        diffs = [
          [opAdd('b', 'bar'), opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])],
          [opAdd('b', 'bar'), opPatch('a', [opPatch(0, [opAdd(32, 'bar')])])]
        ];
        value = decisions.popPath(diffs);
        expect(value).to.be(null);
      });

      it('should return null on empty input', () => {
        expect(decisions.popPath([])).to.be(null);
        expect(decisions.popPath([[], []])).to.be(null);
        expect(decisions.popPath([null, null])).to.be(null);
      });

      it('should only pop patch path if inner diffs have a length of 1, or if popInner is true', () => {
        let diffs: IDiffEntry[][] = [
          [opPatch(0, [opAdd(32, 'bar'), opAdd(2, 'bar')])],
          [opPatch(0, [opAdd(32, 'bar'), opAdd(14, 'bar')])]
        ];
        let value = decisions.popPath(diffs);
        expect(value).to.be(null);

        value = decisions.popPath(diffs, true);
        expect(value).to.not.be(null);
        expect(value.key).to.be(0);
        expect(value.diffs[0].length).to.be(2);
        expect(value.diffs[1].length).to.be(2);

        diffs = [
          [opPatch(0, [opAdd(32, 'bar')])],
          [opPatch(0, [opAdd(32, 'bar'), opAdd(14, 'bar')])]
        ];
        value = decisions.popPath(diffs);
        expect(value).to.be(null);

        value = decisions.popPath(diffs, true);
        expect(value).to.not.be(null);
        expect(value.key).to.be(0);
        expect(value.diffs[0].length).to.be(1);
        expect(value.diffs[1].length).to.be(2);

        diffs = [
          [opPatch(0, [opAdd(32, 'bar'), opAdd(2, 'bar')])],
          [opPatch(0, [opAdd(32, 'bar')])]
        ];
        value = decisions.popPath(diffs);
        expect(value).to.be(null);

        value = decisions.popPath(diffs, true);
        expect(value).to.not.be(null);
        expect(value.key).to.be(0);
        expect(value.diffs[0].length).to.be(2);
        expect(value.diffs[1].length).to.be(1);
      });

    });

    describe('filterDecisions', () => {

      let paths = [
        ['cells', 0, 'outputs', 0],
        ['cells', 0, 'outputs', 1],
        ['cells', 2, 'outputs', 1],
        ['cells', 12, 'outputs', 0, 'data']
      ];

      let decs: decisions.MergeDecision[] = [];
      for (let p of paths) {
        decs.push(new decisions.MergeDecision(p));
      }

      it('should pass all on shared prefix', () => {
        let value = decisions.filterDecisions(decs, ['cells']);
        expect(value).to.eql(decs);
        for (let d of value) {
          expect(d.level).to.be(1);
        }
      });

      it('should return same instances', () => {
        let value = decisions.filterDecisions(decs, ['cells']);
        expect(arraysEqual(value, decs)).to.be(true);
      });

      it('should filter on shared prefix', () => {
        let value = decisions.filterDecisions(decs, ['cells', 0]);
        expect(value).to.eql(decs.slice(0, 2));
        for (let d of value) {
          expect(d.level).to.be(2);
        }
      });

      it('should filter on common segment with skipLevels', () => {
        let value = decisions.filterDecisions(decs, ['outputs'], 2);
        expect(value).to.eql(decs);
        for (let d of value) {
          expect(d.level).to.be(3);
        }
      });

      it('should filter on shared prefix', () => {
        let value = decisions.filterDecisions(decs, ['outputs', 0], 2);
        expect(value).to.eql([decs[0], decs[3]]);
        for (let d of value) {
          expect(d.level).to.be(4);
        }
      });

    });

  });

});
