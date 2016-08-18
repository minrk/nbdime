// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';


import {
  initialize_diff
} from './diff';

import {
  initialize_merge
} from './merge';

import {
  closeTool, getConfigOption
} from './common';

import 'jupyterlab/lib/index.css';
import 'jupyterlab/lib/theme.css';

/** */
function initialize() {
  let onclose = (ev) => { closeTool(); };
  if (getConfigOption('local') || document.getElementById('merge-local')) {
    initialize_merge();
  } else {
    initialize_diff();
  }

  // If launched as a tool, there should be a close button, to indicate that
  // the tool has finshed. If present, wire it to events, and connect to
  // window unload event as well:
  let closeBtn = document.getElementById('nbdime-close') as HTMLButtonElement;
  if (closeBtn) {
    closeBtn.onclick = onclose;
    window.onbeforeunload = onclose;
  }
}

window.onload = initialize;
