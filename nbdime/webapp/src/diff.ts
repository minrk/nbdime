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
  defaultSanitizer
} from 'jupyterlab/lib/sanitizer';

import {
  Widget
} from 'phosphor/lib/ui/widget';

import {
  Panel
} from 'phosphor/lib/ui/panel';

import {
  IDiffEntry
} from './diffutil';

import {
  NotebookDiffModel
} from './diffmodel';

import {
  NotebookDiffWidget
} from './widgets';

import {
  requestJson, getConfigOption
} from './common';


/**
 * Show the diff as represented by the base notebook and a list of diff entries
 */
function showDiff(data: {base: nbformat.INotebookContent, diff: IDiffEntry[]}) {
  const transformers = [
    new JavascriptRenderer(),
    new MarkdownRenderer(),
    new HTMLRenderer(),
    new ImageRenderer(),
    new SVGRenderer(),
    new LatexRenderer(),
    new TextRenderer()
  ];

  let renderers: RenderMime.MimeMap<RenderMime.IRenderer> = {};
  let order: string[] = [];
  for (let t of transformers) {
    for (let m of t.mimetypes) {
      renderers[m] = t;
      order.push(m);
    }
  }
  let rendermime = new RenderMime({
    renderers: renderers, order: order, sanitizer: defaultSanitizer});

  let nbdModel = new NotebookDiffModel(data.base, data.diff);
  let nbdWidget = new NotebookDiffWidget(nbdModel, rendermime);

  let root = document.getElementById('nbdime-root');
  root.innerHTML = '';
  let panel = new Panel();
  panel.id = 'main';
  Widget.attach(panel, root);
  panel.addWidget(nbdWidget);
  window.onresize = () => { panel.update(); };
}


/**
 * Diff form submission callback. Sends a request for a diff to the server based
 * on the content of the form.
 */
function onDiff(e: Event) {
  e.preventDefault();
  let b = (document.getElementById('diff-base') as HTMLInputElement).value;
  let r = (document.getElementById('diff-remote') as HTMLInputElement).value;
  requestDiff(b, r);
  let uri = '/diff?base=' + encodeURIComponent(b) +
    '&remote=' + encodeURIComponent(r);
  history.pushState({base: b, remote: r},
    'Diff: "' + b + '" vs "' + r + '"', uri);
  return false;
};


/**
 * Called when a 'back' is requested
 */
function onPopState(e: PopStateEvent) {
  if (e.state) {
    let eb = (document.getElementById('diff-base') as HTMLInputElement);
    let er = (document.getElementById('diff-remote') as HTMLInputElement);
    eb.value = e.state.base;
    er.value = e.state.remote;
    requestDiff(e.state.base, e.state.remote);
  }
}

/**
 * Make a diff request for the given base/remote specifiers (filenames)
 */
function requestDiff(base: string, remote: string) {
  requestJson('/api/diff',
              {base: base, remote: remote},
              onDiffRequestCompleted,
              onDiffRequestFailed);
}

/**
 * Callback for a successfull diff request
 */
function onDiffRequestCompleted(data: any) {
  showDiff(data);
}

/**
 * Callback for a failed diff request
 */
function onDiffRequestFailed(response: string) {
  console.log('Diff request failed.');
  let root = document.getElementById('nbdime-root');
  root.innerHTML = '<pre>' + response + '</pre>';
}


/**
 * Wire up callbacks.
 */
function attachToForm() {
  let frm = document.getElementById('nbdime-diff-form') as HTMLFormElement;
  if (frm) {
    frm.onsubmit = onDiff;
    // It only makes sense to listen to pop state events when the form is
    // availalbe (i.e. when we are not a diff/mergetool):
    window.onpopstate = onPopState;
  }
}

/** */
export
function initialize_diff() {
  attachToForm();
  // If arguments supplied in config, run diff directly:
  let base = getConfigOption('base');
  let remote = getConfigOption('remote');
  if (base && remote) {
    requestDiff(base, remote);
  }
}
