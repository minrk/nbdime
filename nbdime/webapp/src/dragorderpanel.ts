// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
'use strict';

import {
  Panel, PanelLayout
} from 'phosphor/lib/ui/panel';

import {
  Widget
} from 'phosphor/lib/ui/widget';

import {
  Message
} from 'phosphor/lib/core/messaging';

import {
  ISignal, defineSignal
} from 'phosphor/lib/core/signaling';

import {
  MimeData
} from 'phosphor/lib/core/mimedata';

import {
  Drag, IDragEvent
} from 'phosphor/lib/dom/dragdrop';


/**
 * The class name added to the DragOrderPanel
 */
const PANEL_CLASS = 'jp-DragOrderPanel';

/**
 * The class name added to something which can be used to drag a box
 */
const DRAG_HANDLE = 'jp-mod-dragHandle';

/**
 * The class name of the default drag handle
 */
const DEFAULT_DRAG_HANDLE_CLASS = 'jp-DragOrderPanel-dragHandle';


/**
 * The class name added to a drop target.
 */
const DROP_TARGET_CLASS = 'jp-mod-dropTarget';

/**
 * MIME type of drag data
 */
const MIME_INDEX = 'application/vnd.jupyter.dragindex';

/**
 * The threshold in pixels to start a drag event.
 */
const DRAG_THRESHOLD = 5;



/**
 * A panel which allows the user to rearrange elements
 */
export
class DragOrderPanel extends Panel {

  /**
   * Mark a widget as a drag handle.
   *
   * Using this, any child-widget can be a drag handle, as long as mouse events
   * are propagated from it to the DragOrderPanel.
   */
  static makeHandle(handle: Widget) {
    handle.addClass(DRAG_HANDLE);
  }

  /**
   * Unmark a widget as a drag handle
   */
  static unmakeHandle(handle: Widget) {
    handle.removeClass(DRAG_HANDLE);
  }

  /**
   * Create a default handle for dragging
   */
  static createDefaultHandle(): Widget {
    let widget = new Widget();
    widget.addClass(DEFAULT_DRAG_HANDLE_CLASS);
    DragOrderPanel.makeHandle(widget);
    return widget;
  }



  /**
   * Find the direct child node of `parent`, which has `node` as a descendant.
   *
   * Returns null if not found. Also returns null if it detects an inner drag
   * list.
   */
  protected static findChild(parent: HTMLElement, node: HTMLElement): HTMLElement {
    // Work our way up the DOM to an element which has this node as parent
    let child = null;
    while (node && node !== parent) {
      if (node.classList.contains(PANEL_CLASS)) {
        return null;
      }
      if (node.parentElement === parent) {
        child = node;
        break;
      }
      node = node.parentElement;
    }
    return child;
  }


  /**
   * Returns the index of node in `layout.widgets`.
   *
   * Returns null if not found.
   */
  protected static getIndexOfChildNode(parent: Widget, node: HTMLElement): number {
    let layout = parent.layout as PanelLayout;
    for (let i = 0; i < layout.widgets.length; i++) {
      if (layout.widgets.at(i).node === node) {
        return i;
      }
    }
    return null;
  }

  constructor(options: Panel.IOptions={}) {
    super(options);
    this.addClass(PANEL_CLASS);
  }

  /**
   * Signal that is emitted after the widgets have been moved.
   *
   * The first argument is the panel in which the moved happened.
   * The second argument is the old and the new keys of the move.
   *
   * In the default implementation the keys are indices to the widget positions
   */
  moved: ISignal<DragOrderPanel, {from: any, to: any}>;


  /**
   * Whether all direct children of the list are handles, or only those widgets
   * designated as handles.
   */
  childrenAreDragHandles = false;


  /**
   * Handle the DOM events for the widget.
   *
   * @param event - The DOM event sent to the widget.
   *
   * #### Notes
   * This method implements the DOM `EventListener` interface and is
   * called in response to events on the dock panel's node. It should
   * not be called directly by user code.
   */
  handleEvent(event: Event): void {
    switch (event.type) {
    case 'mousedown':
      this._evtMousedown(event as MouseEvent);
      break;
    case 'mouseup':
      this._evtMouseup(event as MouseEvent);
      break;
    case 'mousemove':
      this._evtMousemove(event as MouseEvent);
      break;
    case 'p-dragenter':
      this._evtDragEnter(event as IDragEvent);
      break;
    case 'p-dragleave':
      this._evtDragLeave(event as IDragEvent);
      break;
    case 'p-dragover':
      this._evtDragOver(event as IDragEvent);
      break;
    case 'p-drop':
      this._evtDrop(event as IDragEvent);
      break;
    default:
      break;
    }
  }

  /**
   * Called when something has been dropped in the panel.
   *
   * The default implementation moves the widget then emits the `moved` signal.
   */
  protected onMove(from: any, to: any): void {
    if (to !== from) {
      let adjustedTo = to;
      if (adjustedTo > from) {
        adjustedTo -= 1;
      }
      this.insertWidget(adjustedTo, this.widgets.at(from));
      this.moved.emit({from: from, to: to});
    }
  }

  /**
   * Find a drop target from a given node
   *
   * Returns null if no valid drop target was found.
   *
   * The default implementation returns the direct child that is the parent of
   * `node`, or `node` if it is itself a direct child.
   */
  protected findDropTarget(node: HTMLElement): HTMLElement {
    return DragOrderPanel.findChild(this.node, node);
  }

  /**
   * Get the drag target widget from key.
   *
   * The default implementation returns the direct child at the index specified
   * by `key`.
   */
  protected targetFromKey(key: any): Widget {
    let index = key as number;
    return this.widgets.at(index);
  }

  /**
   * Given a target node, translates it to a key
   */
  protected keyFromTarget(target: HTMLElement): any {
    if (!target) {
      return null;
    }
    return DragOrderPanel.getIndexOfChildNode(this, target);
  }

  /**
   * Check whether node is a valid drag handle, and get its identifier.
   *
   * Returns null for invalid drag handles.
   *
   * The default implementation returns the index of the direct child which
   * `node` belongs to if it is a valid handle.
   */
  protected findDragTargetKey(node: HTMLElement): any {
    // First find drag handle for node
    let handle: HTMLElement = this.findDragHandle(node);
    if (handle === null) {
      return null;  // No handle, so no drag target
    }
    // Next, continue from handle to a direct child, and return its index
    let child = DragOrderPanel.findChild(this.node, handle);
    let key = this.keyFromTarget(child);
    return key;
  }

  /**
   * Check if node, or any of nodes ancestors are a drag handle
   *
   * If it is a drag handle, it returns the handle, if not returns null.
   */
  protected findDragHandle(node: HTMLElement): HTMLElement {
    if (this.childrenAreDragHandles) {
      // Simple scenario, just look for node among children
          return node;
    } else {
      // First, traverse up DOM to check if click is on a drag handleEvent
      while (node && node !== this.node) {
        if (node.classList.contains(DRAG_HANDLE)) {
          return node;
        }
        node = node.parentElement;
      }
    }
    return null;
  }

  /**
   * Handle `after_attach` messages for the widget.
   */
  protected onAfterAttach(msg: Message): void {
    let node = this.node;
    node.addEventListener('click', this);
    node.addEventListener('dblclick', this);
    node.addEventListener('mousedown', this);
    node.addEventListener('p-dragenter', this);
    node.addEventListener('p-dragleave', this);
    node.addEventListener('p-dragover', this);
    node.addEventListener('p-drop', this);
   }

  /**
   * Handle `before_detach` messages for the widget.
   */
  protected onBeforeDetach(msg: Message): void {
    let node = this.node;
    node.removeEventListener('click', this);
    node.removeEventListener('dblclick', this);
    node.removeEventListener('p-dragenter', this);
    node.removeEventListener('p-dragleave', this);
    node.removeEventListener('p-dragover', this);
    node.removeEventListener('p-drop', this);
    document.removeEventListener('mousemove', this, true);
    document.removeEventListener('mouseup', this, true);
  }

  /**
   * Handle the `'mousedown'` event for the widget.
   */
  private _evtMousedown(event: MouseEvent): void {
    let target = event.target as HTMLElement;
    let key = this.findDragTargetKey(target);
    if (key === null) {
      return;
    }

    // Left mouse press for drag start.
    if (event.button === 0) {
      this._dragData = { pressX: event.clientX, pressY: event.clientY,
                         key: key };
      document.addEventListener('mouseup', this, true);
      document.addEventListener('mousemove', this, true);
    }
  }


  /**
   * Handle the `'mouseup'` event for the widget.
   */
  private _evtMouseup(event: MouseEvent): void {
    if (event.button !== 0 || !this._drag) {
      document.removeEventListener('mousemove', this, true);
      document.removeEventListener('mouseup', this, true);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Handle the `'mousemove'` event for the widget.
   */
  private _evtMousemove(event: MouseEvent): void {
    // Bail if we are the one dragging.
    if (this._drag) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Check for a drag initialization.
    let data = this._dragData;
    let dx = Math.abs(event.clientX - data.pressX);
    let dy = Math.abs(event.clientY - data.pressY);
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) {
      return;
    }

    this._startDrag(data.key, event.clientX, event.clientY);
  }

  /**
   * Handle the `'p-dragenter'` event for the widget.
   */
  private _evtDragEnter(event: IDragEvent): void {
    if (!this._drag) {
      return;
    }
    if (event.mimeData.hasData(MIME_INDEX)) {
      let target = this.findDropTarget(event.target as HTMLElement);
      if (target === null) {
        return;
      }
      target.classList.add(DROP_TARGET_CLASS);
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /**
   * Handle the `'p-dragleave'` event for the widget.
   */
  private _evtDragLeave(event: IDragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    let elements = this.node.getElementsByClassName(DROP_TARGET_CLASS);
    if (elements.length) {
      (elements[0] as HTMLElement).classList.remove(DROP_TARGET_CLASS);
    }
  }

  /**
   * Handle the `'p-dragover'` event for the widget.
   */
  private _evtDragOver(event: IDragEvent): void {
    if (!this._drag) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dropAction = event.proposedAction;
    // Clear any previous drop targets:
    let elements = this.node.getElementsByClassName(DROP_TARGET_CLASS);
    if (elements.length) {
      (elements[0] as HTMLElement).classList.remove(DROP_TARGET_CLASS);
    }
    let target = this.findDropTarget(event.target as HTMLElement);
    if (target === null) {
      return;
    }
    target.classList.add(DROP_TARGET_CLASS);
  }

  /**
   * Handle the `'p-drop'` event for the widget.
   */
  private _evtDrop(event: IDragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.proposedAction === 'none') {
      event.dropAction = 'none';
      return;
    }
    if (!event.mimeData.hasData(MIME_INDEX)) {
      return;
    }
    // Only accept internal moves:
    if (event.source !== this) {
      return;
    }
    let sourceKey = event.mimeData.getData(MIME_INDEX);
    event.dropAction = event.proposedAction;

    let target = event.target as HTMLElement;
    while (target && target.parentElement) {
      if (target.classList.contains(DROP_TARGET_CLASS)) {
        target.classList.remove(DROP_TARGET_CLASS);
        break;
      }
      target = target.parentElement;
    }
    let targetKey = this.keyFromTarget(target);
    if (targetKey === null) {
      // Invalid target somehow
      return;
    }

    // We have an acceptable drop, handle:
    this.onMove(sourceKey, targetKey);
  }

  /**
   * Start a drag event.
   */
  protected _startDrag(key: any, clientX: number, clientY: number): void {
    // Create the drag image.
    let dragImage = this.targetFromKey(key).node.cloneNode(true) as HTMLElement;

    // Set up the drag event.
    this._drag = new Drag({
      dragImage: dragImage,
      mimeData: new MimeData(),
      supportedActions: 'move',
      proposedAction: 'move',
      source: this
    });
    this._drag.mimeData.setData(MIME_INDEX, key);

    // Start the drag and remove the mousemove listener.
    this._drag.start(clientX, clientY).then(action => {
      // If some outside source accepted it, should we remove the widget?
      this._drag = null;
    });
    document.removeEventListener('mousemove', this, true);
  }

  private _drag: Drag = null;
  private _dragData: { pressX: number, pressY: number, key: any } = null;
}

defineSignal(DragOrderPanel.prototype, 'moved');
