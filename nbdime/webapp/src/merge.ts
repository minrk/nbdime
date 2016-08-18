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
  NotebookMergeModel
} from './mergemodel';

import {
  IMergeDecision
} from './mergedecision';

import {
  NotebookMergeWidget
} from './widgets';

import {
  requestJson, getConfigOption, closeTool
} from './common';


let mergeModel: NotebookMergeModel = null;

/**
 * Show the diff as represented by the base notebook and a list of diff entries
 */
function showMerge(data: {
    base: nbformat.INotebookContent,
    merge_decisions: IMergeDecision[]
    }): NotebookMergeModel {
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

  let nbmModel = new NotebookMergeModel(data.base,
      data.merge_decisions);
  let nbdWidget = new NotebookMergeWidget(nbmModel, rendermime);

  let root = document.getElementById('nbdime-root');
  root.innerHTML = '';
  let panel = new Panel();
  panel.id = 'main';
  Widget.attach(panel, root);
  panel.addWidget(nbdWidget);
  window.onresize = () => { panel.update(); };
  return nbmModel;
}

/**
 * Merge form submission callback. Sends a request for a merge to the server
 * based on the content of the form.
 *
 * Also pushes state to history for navigation history wo/reload
 */
function onMerge(e: Event) {
  e.preventDefault();
  let b = (document.getElementById('merge-base') as HTMLInputElement).value;
  let c = (document.getElementById('merge-local') as HTMLInputElement).value;
  let r = (document.getElementById('merge-remote') as HTMLInputElement).value;
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
    let eb = (document.getElementById('merge-base') as HTMLInputElement);
    let el = (document.getElementById('merge-local') as HTMLInputElement);
    let er = (document.getElementById('merge-remote') as HTMLInputElement);

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
              {base: base, local: local, remote: remote},
              onMergeRequestCompleted,
              onMergeRequestFailed);
}

/**
 * Callback for a successfull diff request
 */
function onMergeRequestCompleted(data: any) {
  mergeModel = showMerge(data);
}

/**
 * Callback for a failed diff request
 */
function onMergeRequestFailed(response: string) {
  console.log('Merge request failed.');
  let root = document.getElementById('nbdime-root');
  root.innerHTML = '<pre>' + response + '</pre>';
  mergeModel = null;
}


/**
 * Extract the merged notebook from the model, as well as any remaining
 * conflicts, and send them to the server for storage / further processing.
 */
function saveMerged() {
  if (!mergeModel) {
    return;
  }
  let nb = mergeModel.serialize();
  let conflicts: IMergeDecision[] = [];
  for (let md of mergeModel.conflicts()) {
    conflicts.push(md.serialize());
  }
  submitMerge(nb, conflicts);
}

/**
 * Submit a merged notebook
 */
function submitMerge(mergedNotebook: nbformat.INotebookContent,
                     conflicts: IMergeDecision[]) {
  requestJson('/api/store',
              {merged: mergedNotebook,
               conflicts: conflicts},
               onSubmissionCompleted,
               onSubmissionFailed);
}

/**
 * Callback for a successful store of the submitted merged notebook
 */
function onSubmissionCompleted() {
  // TODO: Indicate success to user!
  mergeModel.unsavedChanges = false;
}

/**
 * Callback for a failed store of the submitted merged notebook
 */
function onSubmissionFailed(response: string) {
  // TODO: Indicate failure + error to user!
}


/**
 *
 */
export
function closeMerge(ev: Event) {
  let conflict = false;
  for (let md of mergeModel.conflicts()) {
    conflict = md.conflict;
    if (conflict) {
      break;
    }
  }
  if (mergeModel.unsavedChanges) {
    // TODO: Ask user if he want to save
  }
  closeTool(conflict ? 1 : 0);
}


/**
 * Wire up callbacks.
 */
function attachToForm() {
  let frm = document.getElementById('nbdime-merge-form') as HTMLFormElement;
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
  let saveBtn = document.getElementById('nbdime-save') as HTMLButtonElement;
  if (saveBtn) {
    saveBtn.onclick = saveMerged;
  }
}
