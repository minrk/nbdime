// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  RenderMime
} from 'jupyterlab/lib/rendermime';

import {
  OutputWidget
} from 'jupyterlab/lib/notebook/output-area';


import {
  loadModeByMIME
} from 'jupyterlab/lib/codemirror';

import {
  Widget
} from 'phosphor/lib/ui/widget';

import {
  Panel, PanelLayout
} from 'phosphor/lib/ui/panel';

import 'codemirror/lib/codemirror.css';

import {
  DiffView, MergeView, IMergeViewEditorConfiguration
} from './mergeview';

import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  valueIn
} from './util';

import {
  DragOrderPanel
} from './dragorderpanel';

import {
  CellDiffModel, NotebookDiffModel, IDiffModel,
  IStringDiffModel, StringDiffModel, OutputDiffModel
} from './diffmodel';

import {
  NotebookMergeModel, CellMergeModel
} from './mergemodel';


const NBDIFF_CLASS = 'jp-Notebook-diff';
const NBMERGE_CLASS = 'jp-Notebook-merge';

const ROOT_METADATA_CLASS = 'jp-Metadata-diff';
const CELLDIFF_CLASS = 'jp-Cell-diff';
const CELLMERGE_CLASS = 'jp-Cell-merge';

const SOURCE_ROW_CLASS = 'jp-Cellrow-source';
const METADATA_ROW_CLASS = 'jp-Cellrow-metadata';
const OUTPUTS_ROW_CLASS = 'jp-Cellrow-outputs';

const TWOWAY_DIFF_CLASS = 'jp-Diff-twoway';
const ADDED_DIFF_CLASS = 'jp-Diff-added';
const DELETED_DIFF_CLASS = 'jp-Diff-deleted';
const UNCHANGED_DIFF_CLASS = 'jp-Diff-unchanged';

// Merge classes:
const BASE_MERGE_CLASS = 'jp-Merge-base';
const LOCAL_MERGE_CLASS = 'jp-Merge-local';
const REMOTE_MERGE_CLASS = 'jp-Merge-remote';
const MERGED_MERGE_CLASS = 'jp-Merge-merged';

const DIFF_CLASSES = ['jp-Diff-base', 'jp-Diff-remote'];
const MERGE_CLASSES = [BASE_MERGE_CLASS, LOCAL_MERGE_CLASS,
    REMOTE_MERGE_CLASS, MERGED_MERGE_CLASS];

const COLLAPISBLE_HEADER = 'jp-Collapsible-header';
const COLLAPISBLE_HEADER_ICON = 'jp-Collapsible-header-icon';
const COLLAPISBLE_HEADER_ICON_OPEN = 'jp-Collapsible-header-icon-opened';
const COLLAPISBLE_HEADER_ICON_CLOSED = 'jp-Collapsible-header-icon-closed';
const COLLAPISBLE_SLIDER = 'jp-Collapsible-slider';
const COLLAPSIBLE_OPEN = 'jp-Collapsible-opened';
const COLLAPSIBLE_CLOSED = 'jp-Collapsible-closed';
const COLLAPSIBLE_CONTAINER = 'jp-Collapsible-container';


/**
 * A list of outputs considered safe.
 */
const safeOutputs = ['text/plain', 'text/latex', 'image/png', 'image/jpeg',
                    'application/vnd.jupyter.console-text'];

/**
 * A list of outputs that are sanitizable.
 */
const sanitizable = ['text/svg', 'text/html'];

/**
 * A list of MIME types that can be shown as string diff.
 */
const stringDiffMimeTypes = ['text/html', 'text/plain'];


/**
 * CollapsibleWidget
 */
class CollapsibleWidget extends Widget {
  static createHeader(headerTitle?: string): HTMLSpanElement {
    let header = document.createElement('div');
    header.className = COLLAPISBLE_HEADER;
    if (headerTitle) {
      // let title = document.createElement('span');
      header.innerText = headerTitle;
      // header.appendChild(title);
    }
    let button = document.createElement('span');
    button.className = COLLAPISBLE_HEADER_ICON;
    header.appendChild(button);

    return header;
  }

  constructor(inner: Widget, headerTitle?: string, collapsed?: boolean) {
    super();
    this.inner = inner;
    let constructor = this.constructor as typeof CollapsibleWidget;
    let header = constructor.createHeader(headerTitle);
    this.button = header.getElementsByClassName(
      COLLAPISBLE_HEADER_ICON)[0] as HTMLElement;
    header.onclick = this.toggleCollapsed.bind(this);
    this.node.appendChild(header);
    this.container = document.createElement('div');
    this.container.className = COLLAPSIBLE_CONTAINER;
    this.slider = document.createElement('div');
    this.slider.classList.add(COLLAPISBLE_SLIDER);
    this.slider.appendChild(inner.node);
    this.container.appendChild(this.slider);
    this.node.appendChild(this.container);

    this.slider.classList.add(
      collapsed === true ?
      COLLAPSIBLE_CLOSED :
      COLLAPSIBLE_OPEN);
    this.button.classList.add(
      collapsed === true ?
      COLLAPISBLE_HEADER_ICON_CLOSED :
      COLLAPISBLE_HEADER_ICON_OPEN);
  }

  toggleCollapsed(): void {
    let slider = this.slider;
    let button = this.button;
    if (this.collapsed) {
      slider.classList.remove(COLLAPSIBLE_CLOSED);
      slider.classList.add(COLLAPSIBLE_OPEN);
      button.classList.remove(COLLAPISBLE_HEADER_ICON_CLOSED);
      button.classList.add(COLLAPISBLE_HEADER_ICON_OPEN);

    } else {
      slider.classList.remove(COLLAPSIBLE_OPEN);
      slider.classList.add(COLLAPSIBLE_CLOSED);
      button.classList.remove(COLLAPISBLE_HEADER_ICON_OPEN);
      button.classList.add(COLLAPISBLE_HEADER_ICON_CLOSED);
    }
  }

  get collapsed(): boolean {
    return this.slider.classList.contains(COLLAPSIBLE_CLOSED);
  }

  inner: Widget;

  slider: HTMLElement;
  container: HTMLElement;
  button: HTMLElement;
}


/**
 * A wrapper view for showing StringDiffModels in a MergeView
 */
class NbdimeMergeView extends Widget {
  constructor(remote: IStringDiffModel, editorClasses: string[],
              local?: IStringDiffModel, merged?: IStringDiffModel) {
    super();
    let opts: IMergeViewEditorConfiguration = {remote: remote};
    opts.collapseIdentical = true;
    opts.local = local ? local : null;
    opts.merged = merged ? merged : null;
    this._mergeview = new MergeView(this.node, opts);
    this._editors = [];
    if (this._mergeview.left) {
      this._editors.push(this._mergeview.left);
    }
    if (this._mergeview.right) {
      this._editors.push(this._mergeview.right);
    }
    if (this._mergeview.merge) {
      this._editors.push(this._mergeview.merge);
    }

    if (remote.mimetype) {
      // Set the editor mode to the MIME type.
      for (let e of this._editors) {
        loadModeByMIME(e.orig, remote.mimetype);
      }
      loadModeByMIME(this._mergeview.base, remote.mimetype);
    }
  }

  protected _mergeview: MergeView;
  protected _editors: DiffView[];
}


/**
 * Widget for outputs with renderable MIME data.
 */
class RenderableOutputView extends Widget {
  constructor(model: OutputDiffModel, editorClass: string[],
              rendermime: RenderMime) {
    super();
    this._rendermime = rendermime;
    let bdata = model.base as nbformat.IOutput;
    let rdata = model.remote as nbformat.IOutput;
    this.layout = new PanelLayout();

    let ci = 0;
    if (bdata) {
      let widget = this.createOutput(bdata, false);
      (this.layout as PanelLayout).addWidget(widget);
      widget.addClass(editorClass[ci++]);
    }
    if (rdata && rdata !== bdata) {
      let widget = this.createOutput(rdata, false);
      (this.layout as PanelLayout).addWidget(widget);
      widget.addClass(editorClass[ci++]);
    }
  }

  /**
   * Checks if all MIME types of a MIME bundle are safe or can be sanitized.
   */
  static safeOrSanitizable(bundle: nbformat.MimeBundle) {
    let keys = Object.keys(bundle);
    for (let key of keys) {
      if (valueIn(key, safeOutputs)) {
        continue;
      } else if (valueIn(key, sanitizable)) {
        let out = bundle[key];
        if (typeof out === 'string') {
          continue;
        } else {
          return false;
        }
      } else {
        return false;
      }
    }
    return true;
  }

  /**
   * Checks if a cell output can be rendered as untrusted (either safe or
   * sanitizable)
   */
  static canRenderUntrusted(model: OutputDiffModel): boolean {
    let toTest: nbformat.IOutput[] = [];
    if (model.base) {
      toTest.push(model.base);
    }
    if (model.remote && model.remote !== model.base) {
      toTest.push(model.remote);
    }
    for (let o of toTest) {
      if (valueIn(o.output_type, ['execute_result', 'display_data'])) {
        let bundle = (o as any).data as nbformat.MimeBundle;
        if (!this.safeOrSanitizable(bundle)) {
          return false;
        }
      } else if (valueIn(o.output_type, ['stream', 'error'])) {
        // Unknown output type
        return false;
      }
    }
    return true;
  }

  /**
   * Create a widget which renders the given cell output
   */
  protected createOutput(output: nbformat.IOutput, trusted: boolean): Widget {
    let widget = new OutputWidget({rendermime: this._rendermime});
    widget.render(output, trusted);
    return widget;
  }

  _sanitized: boolean;
  _rendermime: RenderMime;
}


/**
 * CellDiffWidget for cell changes
 */
export
class CellDiffWidget extends Panel {
  /**
   *
   */
  constructor(model: CellDiffModel, rendermime: RenderMime,
              mimetype: string) {
    super();
    this.addClass(CELLDIFF_CLASS);
    this._model = model;
    this._rendermime = rendermime;
    this.mimetype = mimetype;

    this.init();
  }

  protected init() {
    let model = this.model;

    // Add 'cell added/deleted' notifiers, as appropriate
    let CURR_DIFF_CLASSES = DIFF_CLASSES.slice();  // copy
    if (model.added) {
      let widget = new Widget();
      widget.node.textContent = 'Cell added';
      this.addWidget(widget);
      this.addClass(ADDED_DIFF_CLASS);
      CURR_DIFF_CLASSES = DIFF_CLASSES.slice(0, 1);
    } else if (model.deleted) {
      let widget = new Widget();
      widget.node.textContent = 'Cell deleted';
      this.addWidget(widget);
      this.addClass(DELETED_DIFF_CLASS);
      CURR_DIFF_CLASSES = DIFF_CLASSES.slice(1, 2);
    } else if (model.unchanged) {
      this.addClass(UNCHANGED_DIFF_CLASS);
    } else {
      this.addClass(TWOWAY_DIFF_CLASS);
    }

    // Add inputs and outputs, on a row-by-row basis
    let ctor = this.constructor as typeof CellDiffWidget;
    let sourceView = ctor.createView(
      model.source, model, CURR_DIFF_CLASSES, this._rendermime);
    sourceView.addClass(SOURCE_ROW_CLASS);
    this.addWidget(sourceView);

    if (model.metadata && !model.metadata.unchanged) {
      let metadataView = ctor.createView(
        model.metadata, model, CURR_DIFF_CLASSES, this._rendermime);
      metadataView.addClass(METADATA_ROW_CLASS);
      this.addWidget(metadataView);
    }
    if (model.outputs && model.outputs.length > 0) {
      let container = new Panel();
      let changed = false;
      for (let o of model.outputs) {
        let outputsWidget = ctor.createView(
          o, model, CURR_DIFF_CLASSES, this._rendermime);
        container.addWidget(outputsWidget);
        changed = changed || !o.unchanged || o.added || o.deleted;
      }
      let header = changed ? 'Outputs changed' : 'Outputs unchanged';
      let collapser = new CollapsibleWidget(container, header, !changed);
      collapser.addClass(OUTPUTS_ROW_CLASS);
      this.addWidget(collapser);
    }
  }

  /**
   * Create a new sub-view.
   */
  static
  createView(model: IDiffModel, parent: CellDiffModel,
             editorClasses: string[], rendermime: RenderMime): Widget {
    let view: Widget = null;
    if (model instanceof StringDiffModel) {
      if (model.unchanged && parent.cellType === 'markdown') {
        view = rendermime.render({'text/markdown': model.base});
      } else {
        view = new NbdimeMergeView(model as IStringDiffModel, editorClasses);
      }
    } else if (model instanceof OutputDiffModel) {
      // Take one of three actions, depending on output types
      // 1) Text-type output: Show a MergeView with text diff.
      // 2) Renderable types: Side-by-side comparison.
      // 3) Unknown types: Stringified JSON diff.
      let tmodel = model as OutputDiffModel;
      let renderable = RenderableOutputView.canRenderUntrusted(tmodel);
      for (let mt of rendermime.order) {
        let key = tmodel.hasMimeType(mt);
        if (key) {
          if (!renderable || valueIn(mt, stringDiffMimeTypes)) {
            view = new NbdimeMergeView(tmodel.stringify(key), editorClasses);
          } else if (renderable) {
            view = new RenderableOutputView(tmodel, editorClasses, rendermime);
          }
          break;
        }
      }
      if (!view) {
        view = new NbdimeMergeView(tmodel.stringify(), editorClasses);
      }
    } else {
      throw 'Unrecognized model type.';
    }
    if (model.collapsible) {
      view = new CollapsibleWidget(
          view, model.collapsibleHeader, model.startCollapsed);
    }
    let container = new Panel();
    if (model.added && !parent.added) {
      // Implies this is added output
      let addSpacer = new Widget();
      addSpacer.node.textContent = 'Output added';
      container.addWidget(addSpacer);
      container.addClass(ADDED_DIFF_CLASS);
    } else if (model.deleted && !parent.deleted) {
      // Implies this is deleted output
      let delSpacer = new Widget();
      delSpacer.node.textContent = 'Output deleted';
      container.addWidget(delSpacer);
      container.addClass(DELETED_DIFF_CLASS);
    } else if (model.unchanged && !parent.unchanged) {
      container.addClass(UNCHANGED_DIFF_CLASS);
    } else {
      container.addClass(TWOWAY_DIFF_CLASS);
    }
    container.addWidget(view);
    return container;
  }


  mimetype: string;

  /**
   * Get the model for the widget.
   *
   * #### Notes
   * This is a read-only property.
   */
  get model(): CellDiffModel {
    return this._model;
  }

  protected _model: CellDiffModel = null;
  protected _rendermime: RenderMime = null;
}


/**
 * MetadataWidget for changes to Notebook-level metadata
 */
export
class MetadataDiffWidget extends Panel {
  constructor(model: IDiffModel) {
    super();
    this._model = model;
    console.assert(!model.added && !model.deleted);
    this.addClass(ROOT_METADATA_CLASS);
    this.init();
  }

  init() {
    let model = this._model;
    if (!model.unchanged) {
      this.addClass(TWOWAY_DIFF_CLASS);
      console.assert(model instanceof StringDiffModel);
      let view: Widget = new NbdimeMergeView(
        model as StringDiffModel, DIFF_CLASSES);
      if (model.collapsible) {
        view = new CollapsibleWidget(
          view, model.collapsibleHeader, model.startCollapsed);
      }
      this.addWidget(view);
    }
  }

  private _model: IDiffModel;
}


/**
 * NotebookDiffWidget
 */
export
class NotebookDiffWidget extends Widget {
  constructor(model: NotebookDiffModel, rendermime: RenderMime) {
    super();
    this._model = model;
    this._rendermime = rendermime;
    let layout = this.layout = new PanelLayout();

    this.addClass(NBDIFF_CLASS);

    if (model.metadata) {
      layout.addWidget(new MetadataDiffWidget(model.metadata));
    }
    for (let c of model.cells) {
      layout.addWidget(new CellDiffWidget(c, rendermime, model.mimetype));
    }
  }

  /**
   * Get the model for the widget.
   *
   * #### Notes
   * This is a read-only property.
   */
  get model(): NotebookDiffModel {
    return this._model;
  }

  private _model: NotebookDiffModel;
  private _rendermime: RenderMime = null;
}

/**
 * CellMergeWidget for cell changes
 */
export
class CellMergeWidget extends Panel {
  /**
   *
   */
  constructor(model: CellMergeModel, rendermime: RenderMime,
              mimetype: string) {
    super();
    this.addClass(CELLMERGE_CLASS);
    this._model = model;
    this._rendermime = rendermime;
    this.mimetype = mimetype;

    this.init();
  }

  protected init() {
    let model = this.model;
    let CURR_CLASSES = MERGE_CLASSES.slice();  // copy

    let header = new Panel();
    header.addClass('jp-Merge-cell-header');

    let w = DragOrderPanel.createDefaultHandle();
    header.addWidget(w);

    w = new Widget();
    this.headerTitleWidget = w;
    header.addWidget(w);
    this.deleteToggle = document.createElement('input');
    this.deleteToggle.setAttribute('type', 'checkbox');
    this.deleteToggle.checked = this.model.deleteCell;
    this.deleteToggle.onchange = (event) => {
      this.model.deleteCell = this.deleteToggle.checked;
    };
    w = new Widget();
    let label = document.createElement('label');
    label.innerText = 'Delete cell';
    label.insertBefore(this.deleteToggle, label.childNodes[0]);
    w.node.appendChild(label);
    w.addClass('jp-Merge-delete-toggle');
    header.addWidget(w);
    this.addWidget(header);
    this.header = header;

    /*
     1. Unchanged or one way insert/delete of cell:
        Single r/w editor (merged), with appropriate coloring for insert/delete
     2. Everything else:
        Full 4x merge view
    */
    let ladd = model.local && model.local.added;
    let ldel = model.local && model.local.deleted;
    let radd = model.remote && model.remote.added;
    let rdel = model.remote && model.remote.deleted;
    if (ladd && !radd || ldel && !rdel) {
      this.headerTitle = ladd ? 'Cell added locally' : 'Cell deleted locally';
    } else if (radd && !ladd || rdel && !ldel) {
      this.headerTitle = radd ? 'Cell added remotely' : 'Cell deleted remotely';
    }

    if (valueIn(null, model.subModels) || (
          model.local.unchanged && model.remote.unchanged &&
          model.merged.unchanged) ||
          model.local.added !== model.remote.added) {
      let view = CellDiffWidget.createView(
        model.merged.source, model.merged, CURR_CLASSES, this._rendermime);
      if (ladd && !radd || ldel && !rdel) {
        this.addClass('jp-Merge-oneway-local');
      } else if (radd && !ladd || rdel && !ldel) {
        this.addClass('jp-Merge-oneway-remote');
      }
      this.addWidget(view);
    } else {
      // Setup full 4-way mergeview of source, and same for metadata and outputs
      // as needed (if changed). Source/metadata/output are each a "row"
      let sourceView = this.createMergeView(
        model.local.source,
        model.remote.source,
        model.merged.source,
        CURR_CLASSES);
      sourceView.addClass(SOURCE_ROW_CLASS);
      this.addWidget(sourceView);

      let metadataChanged = false;
      let outputsChanged = false;
      for (let m of model.subModels) {
        if (m.deleted) {
          continue;
        }
        metadataChanged = metadataChanged || (
          m && m.metadata && !m.metadata.unchanged);

        if (m && m.outputs && m.outputs.length > 0) {
          for (let o of m.outputs) {
            outputsChanged = outputsChanged || !o.unchanged;
          }
        }
      }

      if (metadataChanged) {
        let metadataView = this.createMergeView(
            model.local.metadata,
            model.remote.metadata,
            model.merged.metadata,
            CURR_CLASSES);
        metadataView.addClass(METADATA_ROW_CLASS);
        this.addWidget(metadataView);
      }
      if (outputsChanged || (
            model.merged.outputs && model.merged.outputs.length > 0)) {
        let container = new Panel();
        // TODO: Figure out how to deal with outputs

        let header = outputsChanged ? 'Outputs changed' : 'Outputs unchanged';
        let collapser = new CollapsibleWidget(container, header, !outputsChanged);
        collapser.addClass(OUTPUTS_ROW_CLASS);
        this.addWidget(collapser);
      }
    }
  }

  createMergeView(local: IDiffModel, remote: IDiffModel, merged: IDiffModel,
                  editorClasses: string[]): Widget {
    let view: Widget = null;
    if (merged instanceof StringDiffModel) {
      view = new NbdimeMergeView(remote as IStringDiffModel, editorClasses,
        local as IStringDiffModel, merged);
    }
    return view;
  }

  mimetype: string;

  header: Panel;
  deleteToggle: HTMLInputElement;
  headerTitleWidget: Widget;

  set headerTitle(value: string) {
    this.headerTitleWidget.node.innerText = value;
  }

  /**
   * Get the model for the widget.
   *
   * #### Notes
   * This is a read-only property.
   */
  get model(): CellMergeModel {
    return this._model;
  }

  protected _model: CellMergeModel = null;
  protected _rendermime: RenderMime = null;
}


/**
 * NotebookMergeWidget
 */
export
class NotebookMergeWidget extends DragOrderPanel {
  constructor(model: NotebookMergeModel,
              rendermime: RenderMime) {
    super();
    this._model = model;
    this._rendermime = rendermime;
    let layout = this.layout as PanelLayout;

    this.addClass(NBMERGE_CLASS);

    /*if (model.metadata) {
      layout.addChild(new MetadataDiffWidget(model.merged.metadata));
    }*/
    for (let c of model.cells) {
      layout.addWidget(new CellMergeWidget(c, rendermime, model.mimetype));
    }
  }

  /**
   * Get the model for the widget.
   *
   * #### Notes
   * This is a read-only property.
   */
  get model(): NotebookMergeModel {
    return this._model;
  }

  protected onMove(from: number, to: number): void {
    // Move cell in model list
    this._model.cells.splice(to, 0, this._model.cells.splice(from, 1)[0]);
    super.onMove(from, to);
  }

  private _model: NotebookMergeModel;
  private _rendermime: RenderMime = null;
}
