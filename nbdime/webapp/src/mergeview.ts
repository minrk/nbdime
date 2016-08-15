// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// This code is based on the CodeMirror mergeview.js source:
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

'use strict';

import * as CodeMirror from 'codemirror';
import 'codemirror/addon/display/autorefresh';

import {
  IStringDiffModel, Chunk
} from './diffmodel';

import {
  DecisionStringDiffModel
} from './mergemodel';

import {
  DiffRangePos, ChunkSource, IDiffEntry
} from './diffutil';

import {
  valueIn
} from './util';

var Pos = CodeMirror.Pos;
var svgNS = 'http://www.w3.org/2000/svg';


export enum DIFF_OP {
  DIFF_DELETE = -1,
  DIFF_INSERT = 1,
  DIFF_EQUAL = 0
}

export enum EventDirection {
  INCOMING,
  OUTGOING
}

type GDiffEntry = [DIFF_OP, string];
type GDiff = GDiffEntry[];
export type DiffClasses = {chunk: string, start: string, end: string, insert: string, del: string, connect: string};


CodeMirror.defaults.autoRefresh = true;


let leftClasses = { chunk: 'CodeMirror-merge-l-chunk',
          start: 'CodeMirror-merge-l-chunk-start',
          end: 'CodeMirror-merge-l-chunk-end',
          insert: 'CodeMirror-merge-l-inserted',
          del: 'CodeMirror-merge-l-deleted',
          connect: 'CodeMirror-merge-l-connect'};
let rightClasses = { chunk: 'CodeMirror-merge-r-chunk',
          start: 'CodeMirror-merge-r-chunk-start',
          end: 'CodeMirror-merge-r-chunk-end',
          insert: 'CodeMirror-merge-r-inserted',
          del: 'CodeMirror-merge-r-deleted',
          connect: 'CodeMirror-merge-r-connect'};

let mergeClassPrefix = {chunk: 'CodeMirror-merge-m-chunk',
          start: 'CodeMirror-merge-m-chunk-start',
          end: 'CodeMirror-merge-m-chunk-end',
          insert: 'CodeMirror-merge-m-inserted',
          del: 'CodeMirror-merge-m-deleted',
          connect: 'CodeMirror-merge-m-connect'};


export
class DiffView {
  constructor(public model: IStringDiffModel, public type: string,
              public alignChunks: (force?: boolean) => void) {
    this.classes = type === 'left' ?
      leftClasses : type === 'right' ? rightClasses : null;
  }

  init(pane: HTMLElement, edit: CodeMirror.Editor, options: CodeMirror.MergeView.MergeViewEditorConfiguration) {
    this.edit = edit;
    (this.edit.state.diffViews || (this.edit.state.diffViews = [])).push(this);
    let orig = this.model.remote || '';
    this.orig = CodeMirror(pane, copyObj({value: orig}, copyObj(options)));
    this.orig.state.diffViews = [this];

    this.chunks = this.model.getChunks();
    this.dealigned = false;

    this.showDifferences = options.showDifferences !== false;
    this.forceUpdate = this.registerUpdate();
    this.setScrollLock(true, false);
    this.registerScroll();
  }

  setShowDifferences(val) {
    val = val !== false;
    if (val !== this.showDifferences) {
      this.showDifferences = val;
      this.forceUpdate('full');
    }
  }

  registerUpdate() {
    let editMarkers = [];
    let origMarkers = [];
    let debounceChange;
    let updatingFast = false;
    let self: DiffView = this;
    self.updating = false;
    self.updatingFast = false;
    function update(mode?: string) {
      self.updating = true;
      self.updatingFast = false;
      if (mode === 'full') {
        if (self.copyButtons) {
          clear(self.copyButtons);
        }
        self.ensureChunks();
        if (self.classes === null) {
          clearMergeMarks(self.edit, editMarkers);
          clearMergeMarks(self.orig, origMarkers);
        } else {
          clearMarks(self.edit, editMarkers, self.classes);
          clearMarks(self.orig, origMarkers, self.classes);
        }
      }
      if (self.showDifferences) {
        self.updateMarks(
          self.orig, self.model.additions,
          editMarkers, DIFF_OP.DIFF_INSERT);
        self.updateMarks(
          self.edit, self.model.deletions,
          origMarkers, DIFF_OP.DIFF_DELETE);
      }

      self.alignChunks(true);
      self.updating = false;
    }
    function setDealign(fast) {
        let upd = false;
        for (let dv of self.edit.state.diffViews) {
          upd = upd || dv.updating;
        }
        if (upd) {
          return;
        }
        self.dealigned = true;
        set(fast);
    }
    function set(fast) {
        let upd = false;
        for (let dv of self.edit.state.diffViews) {
          upd = upd || dv.updating || dv.updatingFast;
        }
      if (upd) {
        return;
      }
      clearTimeout(debounceChange);
      if (fast === true) {
        self.updatingFast = true;
      }
      debounceChange = setTimeout(update, fast === true ? 20 : 250);
    }
    function change(_cm, change) {
      if (self.model instanceof DecisionStringDiffModel) {
        (self.model as DecisionStringDiffModel).invalidate();
      }
      // Update faster when a line was added/removed
      setDealign(change.text.length - 1 !== change.to.line - change.from.line);
    }
    this.edit.on('change', change);
    this.orig.on('change', change);
    this.edit.on('markerAdded', setDealign);
    this.edit.on('markerCleared', setDealign);
    this.orig.on('markerAdded', setDealign);
    this.orig.on('markerCleared', setDealign);
    this.edit.on('viewportChange', function() { set(false); });
    this.orig.on('viewportChange', function() { set(false); });
    update();
    return update;
  }

  modelInvalid(): boolean {
    return this.model instanceof DecisionStringDiffModel &&
            (this.model as DecisionStringDiffModel).invalid;
  }

  ensureChunks() {
    if (this.modelInvalid()) {
      this.chunks = this.model.getChunks();
    }
  }

  buildGap(decide: (chunk: Chunk, action: string, customDiff?: IDiffEntry[]) => void
           ): HTMLElement {
    let lock = this.lockButton = elt('div', null, 'CodeMirror-merge-scrolllock');
    lock.title = 'Toggle locked scrolling';
    let lockWrap = elt('div', [lock], 'CodeMirror-merge-scrolllock-wrap');
    let self: DiffView = this;
    CodeMirror.on(lock, 'click', function() { self.setScrollLock(!self.lockScroll); });
    let gapElts = [lockWrap];
    if (decide) {
      this.copyButtons = elt('div', null, 'CodeMirror-merge-copybuttons-' + this.type);
      CodeMirror.on(self.copyButtons, 'click', function(e) {
        let node = e.target || e.srcElement;
        if (!node.chunk) {
          return;
        }
        decide(node.chunk, self.type === 'left' ? 'local' : 'remote');
      });
      gapElts.unshift(this.copyButtons);
    }

    return this.gap = elt('div', gapElts, 'CodeMirror-merge-gap');
  }

  registerScroll(): void {
    let self = this;
    this.edit.on('scroll', function() {
      self.syncScroll(EventDirection.OUTGOING);
    });
    this.orig.on('scroll', function() {
      self.syncScroll(EventDirection.INCOMING);
    });
  }

  /**
   * Sync scrolling between `edit` and `orig`. `type` is used to indicate which
   * editor is the source, and which editor is the destination of the sync.
   */
  syncScroll(type: EventDirection): void {
    if (this.modelInvalid()) {
      return;
    }
    if (!this.lockScroll) {
      return;
    }
    // editor: What triggered event, other: What needs to be synced
    let editor, other, now = +new Date;
    if (type == EventDirection.OUTGOING) {
      editor = this.edit;
      other = this.orig;
    } else {
      editor = this.orig;
      other = this.edit;
    }

    if (editor.state.scrollSetBy === this) {
      editor.state.scrollSetBy = null;
      return;
    }

    // Position to update to
    other.state.scrollPosition = editor.getScrollInfo();

    // If ticking, we already have a scroll queued
    if (other.state.scrollTicking) {
      return;
    }

    let sInfo = other.getScrollInfo();
    // Don't queue an event if already synced.
    if (other.state.scrollPosition.top === sInfo.top &&
        other.state.scrollPosition.left === sInfo.left) {
      return;
    }
    // Throttle by requestAnimationFrame().
    // If event is outgoing, this will lead to a one frame delay of other DiffViews
    let self = this;
    window.requestAnimationFrame(function() {
      other.scrollTo(other.state.scrollPosition.left, other.state.scrollPosition.top);
      other.state.scrollTicking = false;
      other.state.scrollSetBy = self;
    });
    other.state.scrollTicking = true;
    return;
  }

  setScrollLock(val: boolean, action?: boolean) {
    this.lockScroll = val;
    if (val && action !== false) {
      this.syncScroll(EventDirection.OUTGOING);
    }
    this.lockButton.innerHTML = val ? '\u21db\u21da' : '\u21db&nbsp;&nbsp;\u21da';
  }


  updateMarks(editor: CodeMirror.Editor, diff: DiffRangePos[],
              markers: any[], type: DIFF_OP) {
    let classes = this.classes;
    let givenClasses = classes !== null;
    if (!givenClasses) {
      classes = copyObj(mergeClassPrefix) as DiffClasses;
    }

    let self = this;
    function markChunk(editor: CodeMirror.Editor, from: number, to: number,
                       source: ChunkSource) {
      if (!givenClasses && source) {
        classes = copyObj(mergeClassPrefix) as DiffClasses;
        for (let k of Object.keys(classes)) {
          classes[k] += '-' + source;
        }
      }
      for (let i = from; i < to; ++i) {
        let line = editor.addLineClass(i, 'background', classes.chunk);
        if (i === from) {
          editor.addLineClass(line, 'background', classes.start);
        }
        if (i === to - 1) {
          editor.addLineClass(line, 'background', classes.end);
        }
        markers.push(line);
      }
      // When the chunk is empty, make sure a horizontal line shows up
      if (from === to) {
        markers.push(editor.addLineClass(from, 'background', classes.start));
      }
    }
    let cls = type === DIFF_OP.DIFF_DELETE ? classes.del : classes.insert;
    editor.operation(function() {
      let edit = editor === self.edit;
      if (self.classes) {
        clearMarks(editor, markers, classes);
      } else {
        clearMergeMarks(editor, markers);
      }
      highlightChars(editor, diff, markers, cls);
      for (let c of self.chunks) {
        if (edit) {
          markChunk(editor, c.editFrom, c.editTo, c.source);
        } else {
          markChunk(editor, c.origFrom, c.origTo, c.source);
        }
      }
    });
  }

  classes: DiffClasses;
  showDifferences: boolean;
  dealigned: boolean;
  forceUpdate: Function;
  orig: CodeMirror.Editor;
  edit: CodeMirror.Editor;
  chunks: Chunk[];
  copyButtons: HTMLElement;
  lockButton: HTMLElement;
  gap: HTMLElement;
  lockScroll: boolean;
  updating: boolean;
  updatingFast: boolean;
}


// Updating the marks for editor content

function clearMergeMarks(editor: CodeMirror.Editor, arr: any[]) {
  for (let postfix of ['-local', '-remote', '-either', '-custom']) {
    let classes = copyObj(mergeClassPrefix) as DiffClasses;
    for (let k of Object.keys(classes)) {
      classes[k] += postfix;
    }
    clearMarks(editor, arr, classes);
  }
}

function clearMarks(editor: CodeMirror.Editor, arr: any[], classes: DiffClasses) {
  for (let i = 0; i < arr.length; ++i) {
    let mark = arr[i];
    if ('clear' in mark) {
      mark.clear();
    } else if (mark.parent) {
      editor.removeLineClass(mark, 'background', classes.chunk);
      editor.removeLineClass(mark, 'background', classes.start);
      editor.removeLineClass(mark, 'background', classes.end);
    }
  }
  arr.length = 0;
}

function highlightChars(editor: CodeMirror.Editor, ranges: DiffRangePos[],
                        markers: any[], cls: string) {
  let doc = editor.getDoc();
  let origCls: string = null;
  if (valueIn(cls, [mergeClassPrefix.del, mergeClassPrefix.insert])) {
    origCls = cls;
  }
  for (let r of ranges) {
    if (origCls !== null) {
      cls = origCls + (r.source ? '-' + r.source : '');
    }
    markers.push(doc.markText(r.from, r.to, {className: cls}));
  }
}


// Updating the gap between editor and original


function getMatchingOrigLine(editLine: number, chunks: Chunk[]): number {
  let editStart = 0, origStart = 0;
  // Start values correspond to either the start of the chunk,
  // or the start of a preceding unmodified part before the chunk.
  // It is the difference between these two that is interesting.
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (chunk.editTo > editLine && chunk.editFrom <= editLine) {
      return null;
    }
    if (chunk.editFrom > editLine) {
      break;
    }
    editStart = chunk.editTo;
    origStart = chunk.origTo;
  }
  return editLine + (origStart - editStart);
}

/**
 * Find which line numbers align which each other, in the
 * set of DiffViews. The returned array is of the format:
 *
 * [ aligned line #1:[Edit line number, (DiffView#1 line number, DiffView#2 line number,) ...],
 *   algined line #2 ..., etc.]
 */
function findAlignedLines(dvs: DiffView[]): number[][] {
  let linesToAlign: number[][] = [];

  // First fill directly from first DiffView
  let dv = dvs[0];
  let others = dvs.slice(1);
  for (let i = 0; i < dv.chunks.length; i++) {
    let chunk = dv.chunks[i];
    let lines = [chunk.editTo, chunk.origTo];
    for (let o of others) {
      lines.push(getMatchingOrigLine(chunk.editTo, o.chunks));
    }
    linesToAlign.push(lines);
  }
  // Then fill any chunks from remaining DiffView, which are not already added
  for (let o = 0; o < others.length; o++) {
    for (let i = 0; i < others[o].chunks.length; i++) {
      let chunk = others[o].chunks[i];
      // Check agains existing matches to see if already consumed:
      for (var j = 0; j < linesToAlign.length; j++) {
        let align = linesToAlign[j];
        if (align[0] === chunk.editTo) {
          // Chunk already consumed, continue to next chunk
          j = -1;
          break;
        } else if (align[0] > chunk.editTo) {
          // New chunk, which should be inserted in pos j,
          // such that linesToAlign are sorted on edit line
          break;
        }
      }
      if (j > -1) {
        let lines = [chunk.editTo, getMatchingOrigLine(chunk.editTo, dv.chunks)];
        for (let k = 0; k < others.length; k++) {
          if (k === o) {
            lines.push(chunk.origTo);
          } else {
            lines.push(getMatchingOrigLine(chunk.editTo, others[k].chunks));
          }
        }
        linesToAlign.splice(j - 1, 0, lines);
      }
    }
  }
  return linesToAlign;
}


function alignLines(cm: CodeMirror.Editor[], lines: number[], aligners): void {
  let maxOffset = 0, offset = [];
  for (let i = 0; i < cm.length; i++) {
    if (lines[i] !== null) {
      let off = cm[i].heightAtLine(lines[i], 'local');
      offset[i] = off;
      maxOffset = Math.max(maxOffset, off);
    }
  }
  for (let i = 0; i < cm.length; i++) {
    if (lines[i] !== null) {
      let diff = maxOffset - offset[i];
      if (diff > 1) {
        aligners.push(padAbove(cm[i], lines[i], diff));
      }
    }
  }
}

function padAbove(cm: CodeMirror.Editor, line: number, size: number): CodeMirror.LineWidget {
  let above = true;
  if (line > cm.getDoc().lastLine()) {
    line--;
    above = false;
  }
  let elt = document.createElement('div');
  elt.className = 'CodeMirror-merge-spacer';
  elt.style.height = size + 'px'; elt.style.minWidth = '1px';
  return cm.addLineWidget(line, elt, {height: size, above: above});
}


export
interface IMergeViewEditorConfiguration extends CodeMirror.EditorConfiguration {
  /**
   * When true stretches of unchanged text will be collapsed. When a number is given, this indicates the amount
   * of lines to leave visible around such stretches (which defaults to 2). Defaults to false.
   */
  collapseIdentical?: boolean | number;

  /**
   * Callback for when stretches of unchanged text are collapsed.
   */
  onCollapse?(mergeView: MergeView, line: number, size: number, mark: CodeMirror.TextMarker): void;

  /**
   * Provides remote diff of document to be shown on the right of the base.
   * To create a diff view, provide only remote.
   */
  remote: IStringDiffModel;

  /**
   * Provides local diff of the document to be shown on the left of the base.
   * To create a diff view, omit local.
   */
  local?: IStringDiffModel;

  /**
   * Provides the partial merge input for a three-way merge.
   */
  merged?: IStringDiffModel;

  /**
   * When true, the base of a three-way merge is shown. Defaults to true.
   */
  showBase?: boolean;

  /**
   * When true, changed pieces of text are highlighted. Defaults to true.
   */
  showDifferences?: boolean;
}

// Merge view, containing 1 or 2 diff views.
export
class MergeView {
  constructor(node: Node, options: IMergeViewEditorConfiguration) {
    this.options = options;
    let remote = options.remote;
    let local = options.local;
    let merged = options.merged;

    let wrap = [];
    let left: DiffView = this.left = null;
    let right: DiffView = this.right = null;
    let merge: DiffView = this.merge = null;
    this.base = null;
    let self = this;
    this.diffViews = [];
    this.aligners = [];
    options.value = (options.remote.base !== null ?
      options.remote.base : options.remote.remote);
    options.lineNumbers = options.lineNumbers !== false;

    /**
     * Different cases possible:
     *   - Local and merged supplied: Merge:
     *     - Always use left, right and merge panes
     *     - Use base if `showBase` not set to false
     *   - Only remote supplied: Diff:
     *     - No change: Use ony base editor
     *     - Entire content added/deleted: Use only base editor,
     *       but with different classes
     *     - Partial changes: Use base + right editor
     * */

    let hasMerge = local !== null && merged !== null;
    if (hasMerge) {
      console.assert(remote.base === local.base);
      let decide = merged instanceof DecisionStringDiffModel ?
        (merged as DecisionStringDiffModel).decide : null;

      if (local.remote === null) {
        // Local value was deleted
        left = this.left = null;
        var leftPane = elt('div', 'Value missing', 'CodeMirror-merge-pane');
      } else {
        left = this.left = new DiffView(local, 'left', this.alignChunks.bind(this));
        this.diffViews.push(left);
        var leftPane = elt('div', null, 'CodeMirror-merge-pane');
      }
      leftPane.className += ' CodeMirror-merge-pane-local';
      wrap.push(leftPane);

      let showBase = options.showBase !== false;
      if (showBase) {
        wrap.push(left.buildGap(decide));
        var basePane = elt('div', null, 'CodeMirror-merge-pane');
        basePane.className += ' CodeMirror-merge-pane-base';
        wrap.push(basePane);
      }

      if (remote.remote === null) {
        // Remote value was deleted
        right = this.right = null;
        var rightPane = elt('div', 'Value missing', 'CodeMirror-merge-pane');
      } else {
        right = this.right = new DiffView(remote, 'right', this.alignChunks.bind(this));
        this.diffViews.push(right);
        var rightPane = elt('div', null, 'CodeMirror-merge-pane');
        wrap.push(right.buildGap(decide));
      }
      rightPane.className += ' CodeMirror-merge-pane-remote';
      wrap.push(rightPane);

      wrap.push(elt('div', null, 'CodeMirror-merge-clear', 'height: 0; clear: both;'));

      merge = this.merge = new DiffView(merged, 'merge', this.alignChunks.bind(this));
      this.diffViews.push(merge);
      var mergePane = elt('div', null, 'CodeMirror-merge-pane');
      mergePane.className += ' CodeMirror-merge-pane-final';
      wrap.push(merge.buildGap(decide));
      wrap.push(mergePane);

      var panes = 3 + (showBase ? 1 : 0);
    } else {
      // Base always used
      var basePane = elt('div', null, 'CodeMirror-merge-pane');
      wrap.push(basePane);
      if (remote.unchanged || remote.added || remote.deleted) {
        if (remote.unchanged) {
          basePane.className += ' CodeMirror-merge-pane-unchanged';
        } else if (remote.added) {
          basePane.className += ' CodeMirror-merge-pane-added';
        } else if (remote.deleted) {
          basePane.className += ' CodeMirror-merge-pane-deleted';
        }
        var panes = 1;
      } else {
        right = this.right = new DiffView(remote, 'right', this.alignChunks.bind(this));
        this.diffViews.push(right);
        var rightPane = elt('div', null, 'CodeMirror-merge-pane');
        rightPane.className += ' CodeMirror-merge-pane-remote';
        wrap.push(right.buildGap(null));
        wrap.push(rightPane);
        var panes = 2;
      }
      wrap.push(elt('div', null, 'CodeMirror-merge-clear', 'height: 0; clear: both;'));
    }

    this.wrap = node.appendChild(elt('div', wrap, 'CodeMirror-merge CodeMirror-merge-' + panes + 'pane'));
    if (basePane !== undefined) {
      this.base = CodeMirror(basePane, copyObj(options));
    }

    if (left) {
      left.init(leftPane, this.base,
        copyObj({readOnly: true}, copyObj(options)) as CodeMirror.MergeView.MergeViewEditorConfiguration);
    }
    if (right) {
      right.init(rightPane, this.base,
        copyObj({readOnly: true}, copyObj(options)) as CodeMirror.MergeView.MergeViewEditorConfiguration);
    }
    if (merge) {
      merge.init(mergePane, this.base,
        copyObj({readOnly: false}, copyObj(options)) as CodeMirror.MergeView.MergeViewEditorConfiguration);
    }

    if (options.collapseIdentical) {
      this.base.operation(function() {
          collapseIdenticalStretches(self, options.collapseIdentical);
      });
    }
    this.initialized = true;
    if (this.left || this.right || this.merge) {
      (this.left || this.right || this.merge).alignChunks(true);
    }
  }

  alignChunks(force?: boolean) {
    let dealigned = false;
    if (!this.initialized) {
      return;
    }
    for (let dv of this.diffViews) {
      dv.ensureChunks();
      if (dv.dealigned) {
        dealigned = true;
        dv.dealigned = false;
      }
    }

    if (!dealigned && !force) {
      return; // Nothing to do
    }
    // Find matching lines
    let linesToAlign = findAlignedLines(this.diffViews);

    // Function modifying DOM to perform alignment:
    let self: MergeView = this;
    let f = function () {

      // Clear old aligners
      var aligners = self.aligners;
      for (let i = 0; i < aligners.length; i++) {
        aligners[i].clear();
      }
      aligners.length = 0;

      // Editors (order is important, so it matches
      // format of linesToAlign)
      let cm: CodeMirror.Editor[] = [self.base];
      let scroll = [];
      for (let dv of self.diffViews) {
        cm.push(dv.orig);
      }
      for (let i = 0; i < cm.length; i++) {
        scroll.push(cm[i].getScrollInfo().top);
      }

      for (let ln = 0; ln < linesToAlign.length; ln++) {
        alignLines(cm, linesToAlign[ln], aligners);
      }

      for (let i = 0; i < cm.length; i++) {
        cm[i].scrollTo(null, scroll[i]);
      }
    };

    // All editors should have an operation (simultaneously),
    // so set up nested operation calls.
    if (!this.base.curOp) {
      f = function(fn) {
        return function() { self.base.operation(fn); };
      }(f);
    }
    for (let dv of this.diffViews) {
      if (!dv.orig.curOp) {
        f = function(fn) {
          return function() { dv.orig.operation(fn); };
        }(f);
      }
    }
    // Perform alignment
    f();
  }

  setShowDifferences(val) {
    if (this.right) {
      this.right.setShowDifferences(val);
    }
    if (this.left) {
      this.left.setShowDifferences(val);
    }
  }

  left: DiffView;
  right: DiffView;
  merge: DiffView;
  wrap: Node;
  base: CodeMirror.Editor;
  options: any;
  diffViews: DiffView[];
  aligners: CodeMirror.LineWidget[];
  initialized: boolean = false;
}

function collapseSingle(cm: CodeMirror.Editor, from: number, to: number): {mark: CodeMirror.TextMarker, clear: () => void} {
  cm.addLineClass(from, 'wrap', 'CodeMirror-merge-collapsed-line');
  let widget = document.createElement('span');
  widget.className = 'CodeMirror-merge-collapsed-widget';
  widget.title = 'Identical text collapsed. Click to expand.';
  let mark = cm.getDoc().markText(
    Pos(from, 0), Pos(to - 1),
    {
      inclusiveLeft: true,
      inclusiveRight: true,
      replacedWith: widget,
      clearOnEnter: true
    }
  );
  function clear() {
    mark.clear();
    cm.removeLineClass(from, 'wrap', 'CodeMirror-merge-collapsed-line');
  }
  CodeMirror.on(widget, 'click', clear);
  return {mark: mark, clear: clear};
}

function collapseStretch(size: number, editors: {line: number, cm: CodeMirror.Editor}[]): CodeMirror.TextMarker {
  let marks = [];
  function clear() {
    for (let i = 0; i < marks.length; i++) {
      marks[i].clear();
    }
  }
  for (let i = 0; i < editors.length; i++) {
    let editor = editors[i];
    let mark = collapseSingle(editor.cm, editor.line, editor.line + size);
    marks.push(mark);
    (mark.mark as any).on('clear', clear);
  }
  return marks[0].mark;
}

function unclearNearChunks(dv: DiffView, margin: number, off: number, clear: boolean[]): void {
  for (let i = 0; i < dv.chunks.length; i++) {
    let chunk = dv.chunks[i];
    for (let l = chunk.editFrom - margin; l < chunk.editTo + margin; l++) {
      let pos = l + off;
      if (pos >= 0 && pos < clear.length) {
        clear[pos] = false;
      }
    }
  }
}

function collapseIdenticalStretches(mv: MergeView, margin: boolean | number): void {
  // FIXME: Use all panes
  if (typeof margin != 'number') {
    margin = 2;
  }
  var clear = [], edit = mv.base, off = edit.getDoc().firstLine();
  for (let l = off, e = edit.getDoc().lastLine(); l <= e; l++) {
    clear.push(true);
  }
  if (mv.left) {
    unclearNearChunks(mv.left, margin as number, off, clear);
  }
  if (mv.right) {
    unclearNearChunks(mv.right, margin as number, off, clear);
  }
  if (mv.merge) {
    unclearNearChunks(mv.merge, margin as number, off, clear);
  }

  for (let i = 0; i < clear.length; i++) {
    if (clear[i]) {
      let line = i + off;
      for (var size = 1; i < clear.length - 1 && clear[i + 1]; i++, size++) {
        // Just finding size
      }
      if (size > margin) {
        let editors = [{line: line, cm: edit}];
        if (mv.left) {
          editors.push({line: getMatchingOrigLine(line, mv.left.chunks),
            cm: mv.left.orig});
        }
        if (mv.right) {
          editors.push({line: getMatchingOrigLine(line, mv.right.chunks),
            cm: mv.right.orig});
        }
        if (mv.merge) {
          editors.push({line: getMatchingOrigLine(line, mv.merge.chunks),
            cm: mv.merge.orig});
        }
        let mark = collapseStretch(size, editors);
        if (mv.options.onCollapse) {
          mv.options.onCollapse(mv, line, size, mark);
        }
      }
    }
  }
}

// General utilities

function elt(tag: string, content?: string | HTMLElement[], className?: string, style?: string): HTMLElement {
  let e = document.createElement(tag);
  if (className) {
    e.className = className;
  }
  if (style) {
    e.style.cssText = style;
  }
  if (typeof content == 'string') {
    e.appendChild(document.createTextNode(content as string));
  } else if (content) {
    for (let i = 0; i < content.length; ++i) {
      e.appendChild((content as HTMLElement[])[i]);
    }
  }
  return e;
}

function clear(node: HTMLElement) {
  for (let count = node.childNodes.length; count > 0; --count) {
    node.removeChild(node.firstChild);
  }
}

function copyObj(obj: Object, target?: Object) {
  if (!target) {
    target = {};
  }
  for (let prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      target[prop] = obj[prop];
    }
  }
  return target;
}

function findPrevDiff(chunks: Chunk[], start: number, isOrig: boolean): number {
  for (let i = chunks.length - 1; i >= 0; i--) {
    let chunk = chunks[i];
    let to = (isOrig ? chunk.origTo : chunk.editTo) - 1;
    if (to < start) {
      return to;
    }
  }
}

function findNextDiff(chunks: Chunk[], start: number, isOrig: boolean): number {
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    let from = (isOrig ? chunk.origFrom : chunk.editFrom);
    if (from > start) {
      return from;
    }
  }
}

function goNearbyDiff(cm, dir): void | any {
  let found = null, views = cm.state.diffViews, line = cm.getCursor().line;
  if (views) {
    for (let i = 0; i < views.length; i++) {
      let dv = views[i];
      let isOrig = cm === dv.orig;
      let pos = dir < 0 ?
        findPrevDiff(dv.chunks, line, isOrig) :
        findNextDiff(dv.chunks, line, isOrig);
      if (pos !== null && (found === null ||
            (dir < 0 ? pos > found : pos < found))) {
        found = pos;
      }
    }
  }
  if (found !== null) {
    cm.setCursor(found, 0);
  } else {
    return CodeMirror.Pass;
  }
}

CodeMirror.commands.goNextDiff = function(cm) {
  return goNearbyDiff(cm, 1);
};
CodeMirror.commands.goPrevDiff = function(cm) {
  return goNearbyDiff(cm, -1);
};
