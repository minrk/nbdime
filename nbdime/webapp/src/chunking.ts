// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';


import {
  DiffRangePos, IDiffEntry, IDiffPatch
} from './diffutil';

import {
  MergeDecision
} from './mergedecision';

import {
  valueIn, shallowCopy
} from './util';


export
type ChunkSource = {
  decision: MergeDecision;
  action: 'local' | 'remote' | 'either' | 'custom' | 'mixed';
};

/**
 * A chunk is a range of lines in a string based diff
 * that logically belong together.
 *
 * Chunks can be used for:
 *  - Correlating diff entries in the base and remote, e.g.
 *    for aligning lines in two editors.
 *  - Finding parts of the unchanged text that are not needed
 *    as context (can be hidden)
 *  - Navigating a diff ("Go to next diff")
 */
export class Chunk {
  constructor(
      public editFrom: number,
      public editTo: number,
      public origFrom: number,
      public origTo: number,
      source?: ChunkSource) {
    this.sources = source ? [source] : [];
  }

  /**
   * Indicates the source of a chunk in a merge condition.
   *
   * For merged content this can be used to indicate whther the chunk originates
   * from base, local, remote or somewhere else.
   */
  sources: ChunkSource[];

  /**
   * Checks whether the given line number is within the range spanned by editFrom - editTo
   */
  inEdit(line: number) {
    return line >= this.editFrom && line <= this.editTo;
  }

  /**
   * Checks whether the given line number is within the range spanned by origFrom - origTo
   */
  inOrig(line: number) {
    return line >= this.origFrom && line <= this.origTo;
  }

  /**
   *
   */
};

export
class Chunker {
  constructor() {
    this.chunks = [];
    this.editOffset = 0;
  }

  protected _getCurrent() {
    if (this._currentGhost) {
      this._currentGhost = null;
      return null;
    }
    return this.chunks.length > 0 ? this.chunks[this.chunks.length - 1] : null;
  }

  protected _overlapChunk(chunk: Chunk, range: DiffRangePos, isAddition: boolean): boolean {
    if (isAddition) {
      return chunk.inOrig(range.from.line);
    } else {
      return chunk.inEdit(range.from.line);
    }
  }

  addDiff(range: DiffRangePos, isAddition: boolean): void {
    let linediff = range.to.line - range.from.line;
    if (range.endsOnNewline) {
      linediff += 1;
    }
    let firstLineNew = range.from.ch === 0 && linediff > 0;

    let startOffset = range.chunkStartLine ? 0 : 1;
    let endOffset =
      range.chunkStartLine && range.endsOnNewline && firstLineNew ?
      0 : 1;

    let current = this._getCurrent();
    if (current) {
      // Have existing chunk, check for overlap
      if (isAddition) {
        if (this._overlapChunk(current, range, isAddition)) {
          current.origTo = Math.max(current.origTo,
              range.to.line + endOffset + linediff);
          current.editTo = Math.max(current.editTo,
              range.to.line + endOffset + this.editOffset);
          if (range.source && !valueIn(range.source, current.sources)) {
            current.sources.push(range.source);
          }
        } else {
          // No overlap with chunk, start new one
          current = null;
        }
      } else {
        if (this._overlapChunk(current, range, isAddition)) {
          current.origTo = Math.max(current.origTo,
              range.to.line + endOffset - this.editOffset);
          current.editTo = Math.max(current.editTo,
              range.to.line + endOffset + linediff);
          if (range.source && !valueIn(range.source, current.sources)) {
            current.sources.push(range.source);
          }
        } else {
          // No overlap with chunk, start new one
          current = null;
        }
      }
    }
    if (!current) {
      // No current chunk, start a new one
      if (isAddition) {
        let startOrig = range.from.line;
        let startEdit = startOrig + this.editOffset;
        current = new Chunk(
          startEdit + startOffset,
          startEdit + endOffset,
          startOrig + startOffset,
          startOrig + endOffset + linediff
        );
      } else {
        let startEdit = range.from.line;
        let startOrig = startEdit - this.editOffset;
        current = new Chunk(
          startEdit + startOffset,
          startEdit + endOffset + linediff,
          startOrig + startOffset,
          startOrig + endOffset
        );
      }
      if (range.source) {
        current.sources.push(range.source);
      }
      this.chunks.push(current);
    }
    this.editOffset += isAddition ? -linediff : linediff;
  }

  /**
   * Chunk a region where changes will occur if a currently unapplied diff were
   * applied.
   */
  addGhost(range: DiffRangePos, isAddition: boolean, offset: number): void {
    // Do a one-to-one chunk as base
    let linediff = range.to.line - range.from.line;
    if (range.endsOnNewline) {
      linediff += 1;
    }
    let firstLineNew = range.from.ch === 0 && linediff > 0;

    let startOffset = range.chunkStartLine ? 0 : 1;
    let endOffset =
      range.chunkStartLine && range.endsOnNewline && firstLineNew ?
      0 : 1;

    let current = this._currentGhost;
    // Subtract offset from other editor
    let startEdit = range.from.line + (isAddition ? offset : 0);
    if (current) {
      // Have existing chunk, check for overlap
      let startOrig = startEdit - this.editOffset;
      if (current.editTo > startEdit) {
        current.origTo = Math.max(current.origTo,
            startOrig + endOffset);
        current.editTo = Math.max(current.editTo,
            startEdit + endOffset);
        if (range.source && !valueIn(range.source, current.sources)) {
          current.sources.push(range.source);
        }
      } else {
        // No overlap with chunk, start new one
        current = null;
      }
    }
    if (!current) {
      let startOrig = startEdit - this.editOffset;
      current = new Chunk(
        startEdit + startOffset,
        startEdit + endOffset,
        startOrig + startOffset,
        startOrig + endOffset
      );
      if (range.source) {
        current.sources.push(range.source);
      }
      this.chunks.push(current);
    }
    this._currentGhost = current;
    // this._doAdd(range, isAddition);
  }

  chunks: Chunk[];
  editOffset: number;

  protected _currentGhost: Chunk = null;
}


/**
 * A chunker that only chunks diffs within lines with each other
 *
 * While the default chunker would chunk together a change at the end of one
 * line with a change at the start of the next line, this chunker will keep
 * each line separate. This is useful e.g. for merging.
 */
export
class LineChunker extends Chunker {
  protected _overlapChunk(chunk: Chunk, range: DiffRangePos, isAddition: boolean): boolean {
    let linediff = range.to.line - range.from.line;
    if (range.endsOnNewline) {
      linediff += 1;
    }
    let firstLineNew = range.from.ch === 0 && linediff > 0;
    let endOffset =
      range.chunkStartLine && range.endsOnNewline && firstLineNew ?
      0 : 1;
    if (isAddition) {
      return chunk.inOrig(range.from.line + 1);
    } else {
      return chunk.inEdit(range.from.line + 1);
    }
  }
}

export
function lineToNormalChunks(lineChunks: Chunk[]): Chunk[] {
    // We already have line chunks, so simply merge those chunks that overlap
    let current: Chunk = null;
    let ret: Chunk[] = [];
    for (let c of lineChunks) {
      if (current === null) {
        current = shallowCopy(c);
      } else {
        if (current.inEdit(c.editFrom)) {
          // Overlaps, combine
          current.origTo = Math.max(current.origTo, c.origTo);
          current.editTo = Math.max(current.editTo, c.editTo);
        } else {
          // No overlap, start new
          ret.push(current);
          current = shallowCopy(c);
        }
      }
    }
    if (current !== null) {
      ret.push(current);
    }
    return ret;
  }


/**
 * Label a set of diffs with a source, recursively.
 */
export
function labelSource(diff: IDiffEntry[], source: ChunkSource): IDiffEntry[] {
  if (diff) {
    for (let d of diff) {
      d.source = source;
      if ((d as IDiffPatch).diff !== undefined) {
        labelSource((d as IDiffPatch).diff, source);
      }
    }
  }
  return diff;
}
