/*-----------------------------------------------------------------------------
| Copyright (c) 2014-2016, PhosphorJS Contributors
|
| Distributed under the terms of the BSD 3-Clause License.
|
| The full license is in the file LICENSE, distributed with this software.
|----------------------------------------------------------------------------*/
import {
  move
} from 'phosphor/lib/algorithm/mutation';

import {
  Vector
} from 'phosphor/lib/collections/vector';

import {
  Message, sendMessage
} from 'phosphor/lib/core/messaging';

import {
  AttachedProperty
} from 'phosphor/lib/core/properties';

import {
  IS_IE
} from 'phosphor/lib/dom/platform';

import {
  Panel, PanelLayout
} from 'phosphor/lib/ui/panel';

import {
  ChildMessage, ResizeMessage, Widget, WidgetMessage
} from 'phosphor/lib/ui/widget';


import './flexpanel.css';


/**
 * The class name added to FlexPanel instances.
 */
const FLEX_PANEL_CLASS = 'p-FlexPanel';

/**
 * The class name added to a FlexPanel child.
 */
const CHILD_CLASS = 'p-FlexPanel-child';

/**
 * The class name added to left-to-right flex layout parents.
 */
const LEFT_TO_RIGHT_CLASS = 'p-mod-left-to-right';

/**
 * The class name added to right-to-left flex layout parents.
 */
const RIGHT_TO_LEFT_CLASS = 'p-mod-right-to-left';

/**
 * The class name added to top-to-bottom flex layout parents.
 */
const TOP_TO_BOTTOM_CLASS = 'p-mod-top-to-bottom';

/**
 * The class name added to bottom-to-top flex layout parents.
 */
const BOTTOM_TO_TOP_CLASS = 'p-mod-bottom-to-top';


/**
 * A panel which arranges its widgets in a single row or column.
 *
 * #### Notes
 * This class provides a convenience wrapper around a [[FlexLayout]].
 */
export
class FlexPanel extends Panel {
  /**
   * Construct a new flex panel.
   *
   * @param options - The options for initializing the flex panel.
   */
  constructor(options: FlexPanel.IOptions = {}) {
    super({ layout: Private.createLayout(options) });
    this.addClass(FLEX_PANEL_CLASS);
  }

  /**
   * Get the layout direction for the flex panel.
   */
  get direction(): FlexPanel.Direction {
    return (this.layout as FlexLayout).direction;
  }

  /**
   * Set the layout direction for the flex panel.
   */
  set direction(value: FlexPanel.Direction) {
    (this.layout as FlexLayout).direction = value;
  }

  /**
   * Get the inter-element spacing for the flex panel.
   */
  get spacing(): number {
    return (this.layout as FlexLayout).spacing;
  }

  /**
   * Set the inter-element spacing for the flex panel.
   */
  set spacing(value: number) {
    (this.layout as FlexLayout).spacing = value;
  }

  /**
   * A message handler invoked on a `'child-added'` message.
   */
  protected onChildAdded(msg: ChildMessage): void {
    msg.child.addClass(CHILD_CLASS);
  }

  /**
   * A message handler invoked on a `'child-removed'` message.
   */
  protected onChildRemoved(msg: ChildMessage): void {
    msg.child.removeClass(CHILD_CLASS);
  }

  /**
   * A message handler invoked on an `'after-attach'` message.
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.fit();
  }
}


/**
 * The namespace for the `FlexPanel` class statics.
 */
export
namespace FlexPanel {
  /**
   * A type alias for a flex panel direction.
   */
  export
  type Direction = FlexLayout.Direction;

  /**
   * An options object for initializing a flex panel.
   */
  export
  interface IOptions {
    /**
     * The layout direction of the panel.
     *
     * The default is `'top-to-bottom'`.
     */
    direction?: Direction;

    /**
     * The spacing between items in the panel.
     *
     * The default is `4`.
     */
    spacing?: number;

    /**
     * The flex layout to use for the flex panel.
     *
     * If this is provided, the other options are ignored.
     *
     * The default is a new `FlexLayout`.
     */
    layout?: FlexLayout;
  }

  /**
   * Get the flex panel stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @returns The flex panel stretch factor for the widget.
   */
  export
  function getStretch(widget: Widget): number {
    return FlexLayout.getGrow(widget);
  }

  /**
   * Set the flex panel stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @param value - The value for the stretch factor.
   */
  export
  function setStretch(widget: Widget, value: number): void {
    FlexLayout.setGrow(widget, value);
  }

  /**
   * Get the flex panel size basis for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @returns The flex panel size basis for the widget.
   */
  export
  function getSizeBasis(widget: Widget): number {
    return FlexLayout.getSizeBasis(widget);
  }

  /**
   * Set the flex panel size basis for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @param value - The value for the size basis.
   */
  export
  function setSizeBasis(widget: Widget, value: number): void {
    FlexLayout.setSizeBasis(widget, value);
  }
}


/**
 * A layout which arranges its widgets in a single row or column.
 */
export
class FlexLayout extends PanelLayout {
  /**
   * Construct a new flex layout.
   *
   * @param options - The options for initializing the layout.
   */
  constructor(options: FlexLayout.IOptions = {}) {
    super();
    if (options.direction !== void 0) {
      this._direction = options.direction;
    }
    if (options.spacing !== void 0) {
      this._spacing = Private.clampSpacing(options.spacing);
    }
  }

  /**
   * Get the layout direction for the flex layout.
   */
  get direction(): FlexLayout.Direction {
    return this._direction;
  }

  /**
   * Set the layout direction for the flex layout.
   */
  set direction(value: FlexLayout.Direction) {
    if (this._direction === value) {
      return;
    }
    this._direction = value;
    if (!this.parent) {
      return;
    }
    Private.toggleDirection(this.parent, value);
    this.parent.fit();
  }

  /**
   * Get the inter-element spacing for the flex layout.
   */
  get spacing(): number {
    return this._spacing;
  }

  /**
   * Set the inter-element spacing for the flex layout.
   */
  set spacing(value: number) {
    value = Private.clampSpacing(value);
    if (this._spacing === value) {
      return;
    }
    this._spacing = value;
    if (!this.parent) {
      return;
    }
    this.parent.fit();
  }

  get wrap(): boolean {
    return this._wrap;
  }

  set wrap(value: boolean) {
    if (this._wrap !== value) {
      this._wrap = value;
      this.parent.node.style.flexWrap = value ? 'wrap' : 'nowrap';
      this.parent.fit();
    }
  }

  isHorizontal(): boolean {
    return this.direction === 'right-to-left' || this.direction === 'left-to-right';
  }

  isVertical(): boolean {
    return !this.isHorizontal();
  }

  /**
   * Attach a widget to the parent's DOM node.
   *
   * @param index - The current index of the widget in the layout.
   *
   * @param widget - The widget to attach to the parent.
   *
   * #### Notes
   * This is a reimplementation of the superclass method.
   */
  protected attachWidget(index: number, widget: Widget): void {
    // Call super implmentation
    super.attachWidget(index, widget);

    // Set order, if applicable
    if (this.order) {
      this.order.insert(index, widget);
    }

    // Post a layout request for the parent widget.
    this.parent.fit();
  }

  /**
   * Change a widget's display order.
   *
   * @param fromIndex - The previous index of the widget in the layout.
   *
   * @param toIndex - The current index of the widget in the layout.
   *
   * @param widget - The widget to move in the parent.
   *
   * #### Notes
   * This is a reimplementation of the superclass method.
   */
  protected moveWidget(fromIndex: number, toIndex: number, widget: Widget): void {
    if (fromIndex !== toIndex) {
      // Change the order of the widget.
      if (!this.order) {
        this.order = new Vector(this.widgets);
      }
      move(this.order, fromIndex, toIndex);
      this._dirty = true;
    }

    // Post an update request for the parent widget.
    this.parent.update();
  }

  /**
   * Detach a widget from the parent's DOM node.
   *
   * @param index - The previous index of the widget in the layout.
   *
   * @param widget - The widget to detach from the parent.
   *
   * #### Notes
   * This is a reimplementation of the superclass method.
   */
  protected detachWidget(index: number, widget: Widget): void {
    // Remove widget form order vector
    if (this.order) {
      let i = 0;
      for (; i < this.order.length; ++i) {
        if (widget === this.order[i]) {
          this.order.removeAt(i);
          break;
        }
      }
    }
    // Call super implmentation
    super.detachWidget(index, widget);

    // Post a layout request for the parent widget.
    this.parent.fit();
  }

  /**
   * A message handler invoked on a `'layout-changed'` message.
   *
   * #### Notes
   * This is called when the layout is installed on its parent.
   */
  protected onLayoutChanged(msg: Message): void {
    Private.toggleDirection(this.parent, this.direction);
    super.onLayoutChanged(msg);
  }

  /**
   * A message handler invoked on an `'after-show'` message.
   */
  protected onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    this.parent.update();
  }

  /**
   * A message handler invoked on an `'after-attach'` message.
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.parent.fit();
  }

  /**
   * A message handler invoked on a `'child-shown'` message.
   */
  protected onChildShown(msg: ChildMessage): void {
    if (IS_IE) { // prevent flicker on IE
      sendMessage(this.parent, WidgetMessage.FitRequest);
    } else {
      this.parent.fit();
    }
  }

  /**
   * A message handler invoked on a `'child-hidden'` message.
   */
  protected onChildHidden(msg: ChildMessage): void {
    if (IS_IE) { // prevent flicker on IE
      sendMessage(this.parent, WidgetMessage.FitRequest);
    } else {
      this.parent.fit();
    }
  }

  /**
   * A message handler invoked on a `'resize'` message.
   */
  protected onResize(msg: ResizeMessage): void {
    if (this.parent.isVisible) {
      this._update();
    }
  }

  /**
   * A message handler invoked on an `'update-request'` message.
   */
  protected onUpdateRequest(msg: Message): void {
    if (this.parent.isVisible) {
      this._update();
    }
  }

  /**
   * A message handler invoked on a `'fit-request'` message.
   */
  protected onFitRequest(msg: Message): void {
    if (this.parent.isAttached) {
      this._fit();
    }
  }

  protected order: Vector<Widget> = null;

  /**
   * Fit the layout to the total size required by the widgets.
   */
  private _fit(): void {
    // Set the dirty flag to ensure only a single update occurs.
    this._dirty = true;

    // Notify the ancestor that it should fit immediately. This may
    // cause a resize of the parent, fulfilling the required update.
    let ancestor = this.parent.parent;
    if (ancestor) {
      sendMessage(ancestor, WidgetMessage.FitRequest);
    }

    // If the dirty flag is still set, the parent was not resized.
    // Trigger the required update on the parent widget immediately.
    if (this._dirty) {
      sendMessage(this.parent, WidgetMessage.UpdateRequest);
    }
  }

  /**
   * Update the layout position and size of the widgets.
   *
   * The parent offset dimensions should be `-1` if unknown.
   */
  private _update(): void {
    // Clear the dirty flag to indicate the update occurred.
    this._dirty = false;

    // Bail early if there are no widgets to layout.
    let widgets = this.order || this.widgets;
    if (widgets.length === 0) {
      return;
    }

    // Set spacing by margins
    let spacing = this.spacing.toString() + 'px';
    if (this.isHorizontal()) {
      for (let i = 0; i < widgets.length - 1; ++i) {
        widgets.at(i).node.style.marginRight = spacing;
      }
    } else {
      for (let i = 0; i < widgets.length - 1; ++i) {
        widgets.at(i).node.style.marginBottom = spacing;
      }
    }

    // Apply stretch style to children
    for (let i = 0; i < widgets.length; ++i) {
        let widget = widgets.at(i);
        let style = widget.node.style;
        let basis = FlexLayout.getSizeBasis(widget);
        let grow = FlexLayout.getGrow(widget);
        style.flexBasis = basis ? basis.toString() + 'px' : '';
        style.flexGrow = grow ? grow.toString() : '';
      }

    // Update display order
    for (let i = 0; i < widgets.length; ++i) {
      let widget = widgets.at(i);
      widget.node.style.order = this.order ?  i.toString() : '';
    }
  }

  private _wrap = false;
  private _spacing = 4;
  private _dirty = false;
  private _direction: FlexLayout.Direction = 'top-to-bottom';
}


/**
 * The namespace for the `FlexLayout` class statics.
 */
export
namespace FlexLayout {
  /**
   * A type alias for a flex layout direction.
   */
  export
  type Direction = (
    'left-to-right' | 'right-to-left' | 'top-to-bottom' | 'bottom-to-top'
  );

  /**
   * An options object for initializing a flex layout.
   */
  export
  interface IOptions {
    /**
     * The direction of the layout.
     *
     * The default is `'top-to-bottom'`.
     */
    direction?: Direction;

    /**
     * The spacing between items in the layout.
     *
     * The default is `4`.
     */
    spacing?: number;
  }

  /**
   * Get the flex layout stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @returns The flex layout stretch factor for the widget.
   */
  export
  function getGrow(widget: Widget): number {
    return Private.growProperty.get(widget);
  }

  /**
   * Set the flex layout stretch factor for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @param value - The value for the stretch factor.
   */
  export
  function setGrow(widget: Widget, value: number): void {
    Private.growProperty.set(widget, value);
  }

  /**
   * Get the flex layout size basis for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @returns The flex layout size basis for the widget.
   */
  export
  function getSizeBasis(widget: Widget): number {
    return Private.sizeBasisProperty.get(widget);
  }

  /**
   * Set the flex layout size basis for the given widget.
   *
   * @param widget - The widget of interest.
   *
   * @param value - The value for the size basis.
   */
  export
  function setSizeBasis(widget: Widget, value: number): void {
    Private.sizeBasisProperty.set(widget, value);
  }
}


/**
 * The namespace for the private module data.
 */
namespace Private {
  /**
   * The property descriptor for a widget stretch factor.
   */
  export
  const growProperty = new AttachedProperty<Widget, number>({
    name: 'grow',
    value: 1,
    coerce: (owner, value) => Math.max(0, Math.floor(value)),
    changed: onChildPropertyChanged
  });

  /**
   * The property descriptor for a widget size basis.
   */
  export
  const sizeBasisProperty = new AttachedProperty<Widget, number>({
    name: 'sizeBasis',
    value: null,
    coerce: (owner, value) => Math.max(0, Math.floor(value)),
    changed: onChildPropertyChanged
  });

  /**
   * Create a flex layout for the given panel options.
   */
  export
  function createLayout(options: FlexPanel.IOptions): FlexLayout {
    return options.layout || new FlexLayout(options);
  }

  /**
   * Test whether a direction has horizontal orientation.
   */
  export
  function isHorizontal(dir: FlexLayout.Direction): boolean {
    return dir === 'left-to-right' || dir === 'right-to-left';
  }

  /**
   * Toggle the CSS direction class for the given widget.
   */
  export
  function toggleDirection(widget: Widget, dir: FlexLayout.Direction): void {
    widget.toggleClass(LEFT_TO_RIGHT_CLASS, dir === 'left-to-right');
    widget.toggleClass(RIGHT_TO_LEFT_CLASS, dir === 'right-to-left');
    widget.toggleClass(TOP_TO_BOTTOM_CLASS, dir === 'top-to-bottom');
    widget.toggleClass(BOTTOM_TO_TOP_CLASS, dir === 'bottom-to-top');
  }

  /**
   * Clamp a spacing value to an integer >= 0.
   */
  export
  function clampSpacing(value: number): number {
    return Math.max(0, Math.floor(value));
  }

  /**
   * The change handler for the attached child properties.
   */
  function onChildPropertyChanged(child: Widget): void {
    let parent = child.parent;
    let layout = parent && parent.layout;
    if (layout instanceof FlexLayout) {
      parent.fit();
    }
  }
}
