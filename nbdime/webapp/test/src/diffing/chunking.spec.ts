// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import expect = require('expect.js');

import {
  DiffRangeRaw, raw2Pos
} from '../../../src/diffutil';

import {
  StringDiffModel
} from '../../../src/diffmodel';


describe('nbdime', () => {

  describe('chunking', () => {

    describe('raw2pos', () => {

      it('should convert a pos in the middle of the first line', () => {
        let base = 'Single line text';
        let raw = new DiffRangeRaw('Single '.length, 'line '.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(0);
        expect(pos[0].to.line).to.equal(0);
        expect(pos[0].from.ch).to.equal(raw.from);
        expect(pos[0].to.ch).to.equal(raw.to);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos in the middle of a non-first line', () => {
        let base = 'Line 1\nLine 2 is now like this.';
        let raw = new DiffRangeRaw('Line 1\nLine 2 is '.length, 'now '.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(1);
        expect(pos[0].to.line).to.equal(1);
        expect(pos[0].from.ch).to.equal('Line 2 is '.length);
        expect(pos[0].to.ch).to.equal('Line 2 is now '.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos in the middle of a non-first line with additional lines', () => {
        let base = 'Line 1\nLine 2 is now like this\nLine 3\nLine4\n';
        let raw = new DiffRangeRaw('Line 1\nLine 2 is '.length, 'now '.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(1);
        expect(pos[0].to.line).to.equal(1);
        expect(pos[0].from.ch).to.equal('Line 2 is '.length);
        expect(pos[0].to.ch).to.equal('Line 2 is now '.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos in the middle of a non-first line with final newline', () => {
        let base = 'Line 1\nLine 2 is now like this\n';
        let raw = new DiffRangeRaw('Line 1\nLine 2 is '.length, 'now '.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(1);
        expect(pos[0].to.line).to.equal(1);
        expect(pos[0].from.ch).to.equal('Line 2 is '.length);
        expect(pos[0].to.ch).to.equal('Line 2 is now '.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos at the start of the first line', () => {
        let base = 'Line 1\nLine 2 is now like this\n';
        let raw = new DiffRangeRaw(0, 'Line '.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(0);
        expect(pos[0].to.line).to.equal(0);
        expect(pos[0].from.ch).to.equal(0);
        expect(pos[0].to.ch).to.equal('Line '.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos at the start of a non-first line', () => {
        let base = 'Line 1\nLine 2 is now like this\n';
        let raw = new DiffRangeRaw('Line 1\n'.length, 'Line '.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(1);
        expect(pos[0].to.line).to.equal(1);
        expect(pos[0].from.ch).to.equal(0);
        expect(pos[0].to.ch).to.equal('Line '.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos including the end of the first line', () => {
        let base = 'Line 1\nLine 2 is now like this\n';
        let raw = new DiffRangeRaw('Line'.length, ' 1'.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(0);
        expect(pos[0].to.line).to.equal(0);
        expect(pos[0].from.ch).to.equal('Line'.length);
        expect(pos[0].to.ch).to.equal('Line 1'.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos with newline in middle', () => {
        let base = 'Line 1\nLine 2 is now like this\n';
        let raw = new DiffRangeRaw('Line '.length, '1\nLine '.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(0);
        expect(pos[0].to.line).to.equal(1);
        expect(pos[0].from.ch).to.equal('Line '.length);
        expect(pos[0].to.ch).to.equal('Line '.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos with newline at start', () => {
        let base = 'Line 1\nLine 2 is now like this\n';
        let raw = new DiffRangeRaw('Line 1'.length, '\nLine 2'.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(0);
        expect(pos[0].to.line).to.equal(1);
        expect(pos[0].from.ch).to.equal('Line 1'.length);
        expect(pos[0].to.ch).to.equal('Line 2'.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(false);
      });

      it('should convert a pos at the start of the first line with newline at start', () => {
        let base = '\nLine 1\nLine 2 is now like this\n';
        let raw = new DiffRangeRaw(0, '\n'.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(0);
        expect(pos[0].to.line).to.equal(0);
        expect(pos[0].from.ch).to.equal(0);
        expect(pos[0].to.ch).to.equal('\n'.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(true);
      });

      it('should convert a pos with newline at end', () => {
        let base = 'Line 1\nLine 2\nLine 3\n';
        let raw = new DiffRangeRaw('Line 1\n'.length, 'Line 2\n'.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(1);
        expect(pos[0].to.line).to.equal(1);
        expect(pos[0].from.ch).to.equal(0);
        expect(pos[0].to.ch).to.equal('Line 2\n'.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(true);
      });

      it('should convert a pos with new at start AND end', () => {
        let base = 'Line 1\nLine 2\nLine 3\nLine 4\n';
        let raw = new DiffRangeRaw('Line 1\nLine 2'.length, '\nLine 3\n'.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(1);
        expect(pos[0].to.line).to.equal(2);
        expect(pos[0].from.ch).to.equal('Line 2'.length);
        expect(pos[0].to.ch).to.equal('Line 3\n'.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(true);
      });

      it('should convert a pos with multiple line insert', () => {
        let base = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
        let raw = new DiffRangeRaw(
          'Line 1\n'.length,
          'Line 2\nLine 3\nLine 4\n'.length, null);
        let pos = raw2Pos([raw], base);
        expect(pos).to.have.length(1);
        expect(pos[0].from.line).to.equal(1);
        expect(pos[0].to.line).to.equal(3);
        expect(pos[0].from.ch).to.equal(0);
        expect(pos[0].to.ch).to.equal('Line 4\n'.length);
        expect(pos[0].chunkStartLine).to.be(true);
        expect(pos[0].endsOnNewline).to.be(true);
      });

    });

    describe('StringDiffModel', () => {
      describe('getLineChunks', () => {

        it('should chunk a single line diff', () => {
          let base = 'Single line text';
          let remote = 'Single updated line text';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw('Single '.length, 'update '.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].editTo).to.equal(chunks[0].origTo);
          expect(chunks[0].editFrom).to.equal(0);
          expect(chunks[0].editTo).to.equal(1);
        });

        it('should chunk a single entry in a multi-line diff', () => {
          let base = 'Line 1\nLine 2 is like this\nLine 3';
          let remote = 'Line 1\nLine 2 is now like this\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1\nLine 2 is '.length, 'now '.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].editTo).to.equal(chunks[0].origTo);
          expect(chunks[0].editFrom).to.equal(1);
          expect(chunks[0].editTo).to.equal(2);
        });

        it('should chunk a start-of-line entry in a multi-line diff', () => {
          let base = 'Line 1\nLine 2 is like this\nLine 3';
          let remote = 'Line 1\nNow Line 2 is like this\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1\n'.length, 'Now '.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].editTo).to.equal(chunks[0].origTo);
          expect(chunks[0].editFrom).to.equal(1);
          expect(chunks[0].editTo).to.equal(2);
        });

        it('should chunk an end-of-line entry in a multi-line diff', () => {
          let base = 'Line 1\nLine 2 is like this\nLine 3';
          let remote = 'Line 1\nLine 2 is like this now\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1\nLine 2 is like this'.length, ' now'.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].editTo).to.equal(chunks[0].origTo);
          expect(chunks[0].origFrom).to.equal(1);
          expect(chunks[0].origTo).to.equal(2);
        });

        it('should chunk a newline at start of entry', () => {
          let base = 'Line 1\nLine 2\nLine 3';
          let remote = 'Line 1\nLine 1.1\nLine 2\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1'.length, '\nLine 1.1'.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].origFrom).to.equal(1);
          expect(chunks[0].editTo).to.equal(1);
          expect(chunks[0].origTo).to.equal(2);
        });

        it('should chunk a newline at end of entry', () => {
          let base = 'Line 1\nLine 2\nLine 3';
          let remote = 'Line 1\nLine 1.1\nLine 2\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1\n'.length, 'Line 1.1\n'.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].origFrom).to.equal(1);
          expect(chunks[0].editTo).to.equal(1);
          expect(chunks[0].origTo).to.equal(2);
        });

        it('should chunk a line split', () => {
          /* Note that this scenario is unlikely to occur for
            * line-based diffs, but might occur for char-based diffs
            * of multi-line strings */
          let base = 'Line 1Line 2\nLine 3';
          let remote = 'Line 1\nLine 2\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1'.length, '\n'.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].origFrom).to.equal(0);
          expect(chunks[0].editTo).to.equal(1);
          expect(chunks[0].origTo).to.equal(2);
        });

        it('should chunk an extended line split', () => {
          /* Note that this scenario is unlikely to occur for
            * line-based diffs, but might occur for char-based diffs
            * of multi-line strings */
          let base = 'Line 1Line 2\nLine 3';
          let remote = 'Line 1\n\n\nLine 2\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1'.length, '\n\n\n'.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].origFrom).to.equal(0);
          expect(chunks[0].editTo).to.equal(1);
          expect(chunks[0].origTo).to.equal(4);
        });

        it('should chunk a newline at start AND end of entry', () => {
          /* Note that this scenario is unlikely to occur for
            * line-based diffs, but might occur for char-based diffs
            * of multi-line strings */
          let base = 'Line 1Line 2\nLine 3';
          let remote = 'Line 1\nLine 1.1\nLine 2\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            'Line 1'.length, '\nLine 1.1\n'.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].origFrom).to.equal(0);
          expect(chunks[0].editTo).to.equal(1);
          expect(chunks[0].origTo).to.equal(3);
        });

        it('should chunk an inserted line at start', () => {
          let base = 'Line 1\nLine 2\nLine 3';
          let remote = 'Line 0\nLine 1\nLine 2\nLine 3';
          let added: DiffRangeRaw[] = [];
          added.push(new DiffRangeRaw(
            0, 'Line 0\n'.length, null));
          let m = new StringDiffModel(base, remote, added, []);
          let chunks = m.getLineChunks();
          expect(chunks).to.have.length(1);
          expect(chunks[0].editFrom).to.equal(chunks[0].origFrom);
          expect(chunks[0].editFrom).to.equal(0);
          expect(chunks[0].editTo).to.equal(0);
          expect(chunks[0].origTo).to.equal(1);
        });

      });
    });

  });

});
