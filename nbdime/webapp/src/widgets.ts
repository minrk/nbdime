// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  IRenderMime
} from 'jupyterlab/lib/rendermime';

import {
  OutputWidget, OutputAreaWidget, OutputAreaModel
} from 'jupyterlab/lib/notebook/output-area';

import {
  IObservableList
} from 'jupyterlab/lib/common/observablelist';

import {
  loadModeByMIME
} from 'jupyterlab/lib/codemirror';

import {
  nbformat
} from 'jupyterlab/lib/notebook/notebook/nbformat';

import {
  Widget
} from 'phosphor/lib/ui/widget';

import {
  Panel, PanelLayout
} from 'phosphor/lib/ui/panel';

import {
  FlexPanel
} from './flexpanel';

import {
  DiffView, MergeView, IMergeViewEditorConfiguration
} from './mergeview';

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
  NotebookMergeModel, CellMergeModel, MetadataMergeModel
} from './mergemodel';


import 'phosphor/styles/base.css';
import 'codemirror/lib/codemirror.css';
import 'jupyterlab/lib/index.css';
import 'jupyterlab/lib/theme.css';
import 'jupyterlab/lib/notebook/index.css';
import 'jupyterlab/lib/notebook/theme.css';


const NBDIFF_CLASS = 'jp-Notebook-diff';
const NBMERGE_CLASS = 'jp-Notebook-merge';

const ROOT_METADATA_CLASS = 'jp-Metadata-diff';
const CELLDIFF_CLASS = 'jp-Cell-diff';
const CELLMERGE_CLASS = 'jp-Cell-merge';
const CELL_HEADER_CLASS = 'jp-Merge-cellHeader';
const CELL_HEADER_TITLE_CLASS = 'jp-Merge-cellHeader-title';

const MARKED_DELETE = 'jp-mod-todelete';

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

const COLLAPSIBLE_CLASS = 'jp-CollapsiblePanel';
const COLLAPSIBLE_HEADER = 'jp-CollapsiblePanel-header';
const COLLAPSIBLE_HEADER_ICON = 'jp-CollapsiblePanel-header-icon';
const COLLAPSIBLE_HEADER_ICON_OPEN = 'jp-CollapsiblePanel-header-icon-opened';
const COLLAPSIBLE_HEADER_ICON_CLOSED = 'jp-CollapsiblePanel-header-icon-closed';
const COLLAPSIBLE_SLIDER = 'jp-CollapsiblePanel-slider';
const COLLAPSIBLE_OPEN = 'jp-CollapsiblePanel-opened';
const COLLAPSIBLE_CLOSED = 'jp-CollapsiblePanel-closed';
const COLLAPSIBLE_CONTAINER = 'jp-CollapsiblePanel-container';


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
 * CollapsiblePanel
 */
class CollapsiblePanel extends Panel {
  static createHeader(headerTitle?: string): Panel {
    let header = new Panel();
    header.addClass(COLLAPSIBLE_HEADER);
    if (headerTitle) {
      // let title = document.createElement('span');
      header.node.innerText = headerTitle;
      // header.appendChild(title);
    }
    let button = document.createElement('span');
    button.className = COLLAPSIBLE_HEADER_ICON;
    header.node.appendChild(button);

    return header;
  }

  constructor(inner: Widget, headerTitle?: string, collapsed?: boolean) {
    super();
    this.addClass(COLLAPSIBLE_CLASS);
    this.inner = inner;
    let constructor = this.constructor as typeof CollapsiblePanel;
    let header = constructor.createHeader(headerTitle);
    this.button = header.node.getElementsByClassName(
      COLLAPSIBLE_HEADER_ICON)[0] as HTMLElement;
    header.node.onclick = this.toggleCollapsed.bind(this);
    this.addWidget(header);
    this.container = new Panel();
    this.container.addClass(COLLAPSIBLE_CONTAINER);
    this.slider = new Panel();
    this.slider.addClass(COLLAPSIBLE_SLIDER);
    this.slider.addWidget(inner);
    this.container.addWidget(this.slider);
    this.addWidget(this.container);

    this.slider.addClass(
      collapsed === true ?
      COLLAPSIBLE_CLOSED :
      COLLAPSIBLE_OPEN);
    this.button.classList.add(
      collapsed === true ?
      COLLAPSIBLE_HEADER_ICON_CLOSED :
      COLLAPSIBLE_HEADER_ICON_OPEN);
  }

  toggleCollapsed(): void {
    let slider = this.slider;
    let button = this.button;
    if (this.collapsed) {
      slider.removeClass(COLLAPSIBLE_CLOSED);
      slider.addClass(COLLAPSIBLE_OPEN);
      button.classList.remove(COLLAPSIBLE_HEADER_ICON_CLOSED);
      button.classList.add(COLLAPSIBLE_HEADER_ICON_OPEN);

    } else {
      slider.removeClass(COLLAPSIBLE_OPEN);
      slider.addClass(COLLAPSIBLE_CLOSED);
      button.classList.remove(COLLAPSIBLE_HEADER_ICON_OPEN);
      button.classList.add(COLLAPSIBLE_HEADER_ICON_CLOSED);
    }
  }

  get collapsed(): boolean {
    return this.slider.hasClass(COLLAPSIBLE_CLOSED);
  }

  inner: Widget;

  slider: Panel;
  container: Panel;
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
              rendermime: IRenderMime) {
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
  _rendermime: IRenderMime;
}



/**
 * Widget for showing side by side comparison and picking of merge outputs
 */
class RenderableOutputsMergeView extends DragOrderPanel {

  static makeOutputsDraggable(area: OutputAreaWidget): void {
    let i = area.layout.iter();
    for (let w = i.next(); w !== undefined; w = i.next()) {
      DragOrderPanel.makeHandle(w);
    }
  }

  /**
   *
   */
  constructor(merged: nbformat.IOutput[],
              classes: string[], rendermime: IRenderMime,
              base?: nbformat.IOutput[], remote?: nbformat.IOutput[],
              local?: nbformat.IOutput[]) {
    super();

    if (!base !== !remote || !base !== !local) {
      // Assert that either none, or all of base/remote/local are given
      throw 'Renderable outputs merge-view either takes only merged output ' +
        'or a full set of four output lists.';
    }

    if (base) {
      this.base = new OutputAreaModel();
      for (let output of base) {
          this.base.add(output);
      }
      this.remote = new OutputAreaModel();
      for (let output of remote) {
          this.remote.add(output);
      }
      this.local = new OutputAreaModel();
      for (let output of local) {
          this.local.add(output);
      }
    }
    this.merged = new OutputAreaModel();
    for (let output of merged) {
        this.merged.add(output);
    }
    this.rendermime = rendermime;
    this.panes = [];

    this.init(classes);
  }

  init(classes: string[]): void {
    let row = new FlexPanel({direction: 'left-to-right'});
    if (this.local) {
      let leftPane = new OutputAreaWidget({rendermime: this.rendermime});
      leftPane.addClass(classes[1]);
      leftPane.model = this.local;
      row.addWidget(leftPane);
      this.panes.push(leftPane);
    }
    if (this.base) {
      let basePane = new OutputAreaWidget({rendermime: this.rendermime});
      basePane.addClass(classes[0]);
      basePane.model = this.base;
      row.addWidget(basePane);
      this.panes.push(basePane);
    }
    if (this.remote) {
      let rightPane = new OutputAreaWidget({rendermime: this.rendermime});
      rightPane.addClass(classes[2]);
      rightPane.model = this.remote;
      row.addWidget(rightPane);
      this.panes.push(rightPane);
    }
    if (row.widgets.length > 0) {
      this.addWidget(row);
      row = new FlexPanel({direction: 'left-to-right'});
    }
    this.mergePane = new OutputAreaWidget({rendermime: this.rendermime});
    this.mergePane.addClass(classes[3]);
    this.mergePane.model = this.merged;
    row.addWidget(this.mergePane);
    this.panes.push(this.mergePane);
    this.addWidget(row);

    for (let p of this.panes) {
      RenderableOutputsMergeView.makeOutputsDraggable(p);
    }
  }

  /**
   * Overrided version to allow drag and drop from source lists to merged list
   */
  protected findDragTargetKey(node: HTMLElement): any {
    // First check for a drag handle
    let handle = this.findDragHandle(node);
    if (handle === null) {
      return null;
    }

    // Next find out which pane it belongs to, and which output it belongs to
    return this.keyFromTarget(handle);
  }

  /**
   * Overrided version to allow identifying source pane and source output
   */
  protected keyFromTarget(node: HTMLElement): any {
    for (let pane of this.panes) {
      let child = DragOrderPanel.findChild(pane.node, node);
      if (child !== null) {
        let paneIndex = this.panes.indexOf(pane);
        return [paneIndex, DragOrderPanel.getIndexOfChildNode(pane, child)];
      }
    }
    return null;
  }

  /**
   * Overrided version to allow identifying source pane and source output
   */
  protected targetFromKey(key: any): Widget {
    let indices = key as number[];
    let paneIndex = indices[0];
    let outputIndex = indices[1];
    let pane = this.panes[paneIndex];
    return (pane.layout as PanelLayout).widgets.at(outputIndex);
  }


  /**
   * Called when something has been dropped in the panel.
   */
  protected onMove(from: number[], to: number[]): void {
    let paneFrom = from[0];
    let paneTo = to[0];
    if (this.panes[paneTo] !== this.mergePane) {
      // Shouldn't happen if drop target code is correct...
      return;
    }
    let outputFrom = from[1];
    let outputTo = to[1];
    let adjustedTo = outputTo;
    if (paneFrom === paneTo) {
      if (outputTo > outputFrom) {
        // Have to adjust index for insertWidget in same instance
        adjustedTo -= 1;
      } else if (outputFrom === outputTo) {
        // No-op, same position
        return;
      }
    }
    let toModel = this.panes[paneTo].model;
    let fromModel = this.panes[paneFrom].model;
    let toList = (toModel as any)._list as IObservableList<OutputAreaModel.Output>;
    if (paneTo !== paneFrom) {
      toList.insert(adjustedTo, fromModel.get(outputFrom));
    } else {
      toList.move(outputFrom, adjustedTo);
      if (adjustedTo + 1 < toModel.length) {
        (this.panes[paneTo] as any)._updateChild(adjustedTo + 1);
      }
      (this.panes[paneTo] as any)._updateChild(outputFrom);
    }
    (this.panes[paneTo] as any)._updateChild(adjustedTo);
    RenderableOutputsMergeView.makeOutputsDraggable(this.panes[paneTo]);
    this.moved.emit({from: from, to: to});
  }

  /**
   * Find a drop target from a given node
   *
   * Returns null if no valid drop target was found.
   */
  protected findDropTarget(node: HTMLElement): HTMLElement {
    // Only valid drop target is in merge pane!
    return DragOrderPanel.findChild(this.mergePane.node, node);
  }

  base: OutputAreaModel = null;

  remote: OutputAreaModel = null;

  local: OutputAreaModel = null;

  merged: OutputAreaModel;

  mergePane: OutputAreaWidget;

  panes: OutputAreaWidget[];

  rendermime: IRenderMime;
}


/**
 * CellDiffWidget for cell changes
 */
export
class CellDiffWidget extends Panel {
  /**
   *
   */
  constructor(model: CellDiffModel, rendermime: IRenderMime,
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
      let collapser = new CollapsiblePanel(container, header, !changed);
      collapser.addClass(OUTPUTS_ROW_CLASS);
      this.addWidget(collapser);
    }
  }

  /**
   * Create a new sub-view.
   */
  static
  createView(model: IDiffModel, parent: CellDiffModel,
             editorClasses: string[], rendermime: IRenderMime): Widget {
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
      view = new CollapsiblePanel(
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
    } else if (model.unchanged) {
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
  protected _rendermime: IRenderMime = null;
}


/**
 * MetadataWidget for changes to Notebook-level metadata
 */
export
class MetadataDiffWidget extends Panel {
  constructor(model: IStringDiffModel) {
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
      let view: Widget = new NbdimeMergeView(
        model, DIFF_CLASSES);
      if (model.collapsible) {
        view = new CollapsiblePanel(
          view, model.collapsibleHeader, model.startCollapsed);
      }
      this.addWidget(view);
    }
  }

  private _model: IStringDiffModel;
}


/**
 * NotebookDiffWidget
 */
export
class NotebookDiffWidget extends Widget {
  constructor(model: NotebookDiffModel, rendermime: IRenderMime) {
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
  private _rendermime: IRenderMime = null;
}

/**
 * CellMergeWidget for cell changes
 */
export
class CellMergeWidget extends Panel {

  static createMergeView(local: IDiffModel, remote: IDiffModel, merged: IDiffModel,
                         editorClasses: string[]): Widget {
    let view: Widget = null;
    if (merged instanceof StringDiffModel) {
      view = new NbdimeMergeView(remote as IStringDiffModel, editorClasses,
        local as IStringDiffModel, merged);
    }
    return view;
  }

  protected static getOutputs(models: OutputDiffModel[], base?: boolean): nbformat.IOutput[] {
    if (!models) {
      return null;
    }
    let raw: nbformat.IOutput[] = [];
    for (let m of models) {
      if (base === true) {
        if (m.base) {
          raw.push(m.base);
        }
      } else {
        if (m.remote) {
          raw.push(m.remote);
        }
      }
    }
    return raw;
  }

  /**
   *
   */
  constructor(model: CellMergeModel, rendermime: IRenderMime,
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

    this.createHeader();

    /*
     Two different display layoutsnding on cell merge type:
     1. Unchanged or one way insert/delete of cell, or identical insert/delete:
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

    if (valueIn(null, model.subModels) || (  // One sided change
          model.local.unchanged && model.remote.unchanged &&
          model.merged.unchanged) ||  // Unchanged
          model.local.added !== model.remote.added ||  // Onesided addition
          model.local.added ||  // Implies identical addition
          model.local.deleted && model.remote.deleted   // Deletion on both
          ) {
      // Add single view of source:
      let view = CellDiffWidget.createView(
        model.merged.source, model.merged, CURR_CLASSES, this._rendermime);
      if (ladd && !radd || ldel && !rdel) {
        this.addClass('jp-Merge-oneway-local');
      } else if (radd && !ladd || rdel && !ldel) {
        this.addClass('jp-Merge-oneway-remote');
      } else if (ldel && rdel) {
        this.headerTitle = 'Deleted on both sides';
        this.addClass('jp-Merge-twoway-deletion');
      } else if (ladd && radd) {
        this.headerTitle = 'Added on both sides';
        this.addClass('jp-Merge-twoway-addition');
      }
      view.addClass(SOURCE_ROW_CLASS);
      this.addWidget(view);
    } else {
      // Setup full 4-way mergeview of source, metadata and outputs
      // as needed (if changed). Source/metadata/output are each a "row"
      let sourceView: Widget = null;
      if (model.local.source.unchanged && model.remote.source.unchanged &&
          model.merged.source.unchanged) {
        // Use single unchanged view of source
        sourceView = CellDiffWidget.createView(
          model.merged.source, model.merged, CURR_CLASSES, this._rendermime);
      } else {
        sourceView = CellMergeWidget.createMergeView(
          model.local.source,
          model.remote.source,
          model.merged.source,
          CURR_CLASSES);
      }
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
        let metadataView = CellMergeWidget.createMergeView(
            model.local.metadata,
            model.remote.metadata,
            model.merged.metadata,
            CURR_CLASSES);
        let container = new Panel();
        container.addWidget(metadataView);

        let header = 'Metadata changed';
        let collapser = new CollapsiblePanel(container, header, true);
        collapser.addClass(METADATA_ROW_CLASS);
        this.addWidget(collapser);
      }
      if (outputsChanged || (
            model.merged.outputs && model.merged.outputs.length > 0)) {
        // TODO: Figure out how to deal with outputs
        let baseOut = CellMergeWidget.getOutputs(model.merged.outputs, true);
        let localOut = CellMergeWidget.getOutputs(model.local.outputs);
        let remoteOut = CellMergeWidget.getOutputs(model.remote.outputs);
        let mergedOut = CellMergeWidget.getOutputs(model.merged.outputs);
        let view = new RenderableOutputsMergeView(
          mergedOut, MERGE_CLASSES, this._rendermime,
          baseOut, remoteOut, localOut);

        let header = outputsChanged ? 'Outputs changed' : 'Outputs unchanged';
        let collapser = new CollapsiblePanel(view, header, !outputsChanged);
        collapser.addClass(OUTPUTS_ROW_CLASS);
        this.addWidget(collapser);
      }
    }
  }

  protected createHeader(): void {
    let header = new Panel();
    header.addClass(CELL_HEADER_CLASS);

    // Add drag handle
    let w = DragOrderPanel.createDefaultHandle();
    header.addWidget(w);

    // Add title widget
    w = new Widget();
    this.headerTitleWidget = w;
    w.addClass(CELL_HEADER_TITLE_CLASS);
    header.addWidget(w);

    // Add "delete cell" checkbox
    this.deleteToggle = document.createElement('input');
    this.deleteToggle.setAttribute('type', 'checkbox');
    this.deleteToggle.checked = this.model.deleteCell;
    if (this.model.deleteCell) {
      this.addClass(MARKED_DELETE);
    }
    this.deleteToggle.onchange = (event) => {
      this.model.deleteCell = this.deleteToggle.checked;
      if (this.model.deleteCell) {
        this.addClass(MARKED_DELETE);
      } else {
        this.removeClass(MARKED_DELETE);
      }
    };
    // Create label for checkbox:
    w = new Widget();
    let label = document.createElement('label');
    label.innerText = 'Delete cell';
    // Combine checkbox and label:
    label.insertBefore(this.deleteToggle, label.childNodes[0]);
    // Add checkbox to header:
    w.node.appendChild(label);
    w.addClass('jp-Merge-delete-toggle');
    header.addWidget(w);

    // Add header to widget
    this.addWidget(header);
    this.header = header;
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
  protected _rendermime: IRenderMime = null;
}

/**
 * MetadataWidget for changes to Notebook-level metadata
 */
export
class MetadataMergeWidget extends Panel {
  constructor(model: MetadataMergeModel) {
    super();
    this._model = model;
    this.addClass(ROOT_METADATA_CLASS);
    this.init();
  }

  init() {
    let model = this._model;
    let CURR_CLASSES = MERGE_CLASSES.slice();  // copy

    let view: Widget = new NbdimeMergeView(
      model.remote, CURR_CLASSES, model.local, model.merged);
    view = new CollapsiblePanel(
      view, 'Notebook metadata changed', true);
    this.addWidget(view);
  }

  private _model: MetadataMergeModel;
}


/**
 * NotebookMergeWidget
 */
export
class NotebookMergeWidget extends DragOrderPanel {
  constructor(model: NotebookMergeModel,
              rendermime: IRenderMime) {
    super();
    this._model = model;
    this._rendermime = rendermime;
    let layout = this.layout as PanelLayout;

    this.addClass(NBMERGE_CLASS);

    if (model.metadata) {
      layout.addWidget(new MetadataMergeWidget(model.metadata));
    }
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
  private _rendermime: IRenderMime = null;
}
