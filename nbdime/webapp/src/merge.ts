// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';


import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  RenderMime
} from 'jupyterlab/lib/rendermime';

import {
  HTMLRenderer, LatexRenderer, ImageRenderer, TextRenderer,
  JavascriptRenderer, SVGRenderer, MarkdownRenderer
} from 'jupyterlab/lib/renderers';

import {
  Widget
} from 'phosphor-widget';

import {
  Panel
} from 'phosphor-panel';

import {
  IDiffEntry
} from './diffutil';

import {
  NotebookMergeModel
} from './mergemodel';

import {
  IMergeDecision
} from './mergedecision';

import {
  NotebookMergeWidget
} from './widgets';

import {
  requestJson, getConfigOption
} from './common';


/**
 * Show the diff as represented by the base notebook and a list of diff entries
 */
function showMerge(data: {
    base: nbformat.INotebookContent,
    merge_decisions: IMergeDecision[]
    }) {
  const transformers = [
    new JavascriptRenderer(),
    new MarkdownRenderer(),
    new HTMLRenderer(),
    new ImageRenderer(),
    new SVGRenderer(),
    new LatexRenderer(),
    new TextRenderer()
  ];

  let renderers: RenderMime.MimeMap<RenderMime.IRenderer<Widget>> = {};
  let order: string[] = [];
  for (let t of transformers) {
    for (let m of t.mimetypes) {
      renderers[m] = t;
      order.push(m);
    }
  }
  let rendermime = new RenderMime<Widget>({
    renderers:renderers, order:order});

  let nbmModel = new NotebookMergeModel(data.base,
      data.merge_decisions);
  let nbdWidget = new NotebookMergeWidget(nbmModel, rendermime);

  let root = document.getElementById('nbdime-root');
  root.innerHTML = '';
  let panel = new Panel();
  panel.id = 'main';
  panel.attach(root);
  panel.addChild(nbdWidget);
  window.onresize = () => { panel.update(); };
}

/**
 * Merge form submission callback. Sends a request for a merge to the server
 * based on the content of the form.
 *
 * Also pushes state to history for navigation history wo/reload
 */
function onMerge(e: Event) {
  e.preventDefault();
  var b = (document.getElementById('merge-base') as HTMLInputElement).value;
  var c = (document.getElementById('merge-local') as HTMLInputElement).value;
  var r = (document.getElementById('merge-remote') as HTMLInputElement).value;
  requestMerge(b, c, r);
  let uri = '/merge?base=' + encodeURIComponent(b) +
    '&local=' + encodeURIComponent(c) +
    '&remote=' + encodeURIComponent(r);
  history.pushState({base: b, local: c, remote: r},
    'Merge: "' + c + '" - "' + b + '" - "' + r + '"', uri);
  return false;
};

/**
 * Called when a 'back' is requested
 */
function onPopState(e: PopStateEvent) {
  if (e.state) {
    var eb = (document.getElementById('merge-base') as HTMLInputElement);
    var el = (document.getElementById('merge-local') as HTMLInputElement);
    var er = (document.getElementById('merge-remote') as HTMLInputElement);

    eb.value = e.state.base;
    el.value = e.state.local;
    er.value = e.state.remote;
    requestMerge(e.state.base, e.state.local, e.state.remote);
  }
}


/**
 * Make a diff request for the given base/remote specifiers (filenames)
 */
function requestMerge(base: string, local: string, remote: string) {
  requestJson('/api/merge',
              {base:base, local:local, remote:remote},
              onMergeRequestCompleted,
              onMergeRequestFailed);
}

/**
 * Callback for a successfull diff request
 */
function onMergeRequestCompleted(data: any) {
  showMerge(data);
}

/**
 * Callback for a failed diff request
 */
function onMergeRequestFailed() {
  console.log('Merge request failed.');
}


/**
 * Wire up callbacks.
 */
function attachToForm() {
  var frm = document.getElementById('nbdime-merge-form') as HTMLFormElement;
  if (frm) {
    frm.onsubmit = onMerge;
    // It only makes sense to listen to pop state events when the form is
    // availalbe (i.e. when we are not a diff/mergetool):
    window.onpopstate = onPopState;
  }
}

/** */
export
function initialize_merge() {
  attachToForm();
  // If arguments supplied in config, run diff directly:
  let base = getConfigOption('base');
  let local = getConfigOption('local');  // Only available for merge
  let remote = getConfigOption('remote');
  if (base && local && remote) {
    requestMerge(base, local, remote);
  }
}
