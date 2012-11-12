/**
 * Copyright 2012 Google, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

/**
 * @fileoverview Canvas painting context.
 *
 * @author benvanik@google.com (Ben Vanik)
 */

goog.provide('wtf.ui.PaintContext');

goog.require('goog.Disposable');
goog.require('wtf.timing');
goog.require('wtf.util.canvas');



/**
 * Canvas painting context.
 * Supports child contexts to enable modular nested rendering.
 *
 * @param {!HTMLCanvasElement} canvas Canvas element.
 * @param {wtf.ui.PaintContext=} opt_parentContext Parent paint context.
 * @constructor
 * @extends {goog.Disposable}
 */
wtf.ui.PaintContext = function(canvas, opt_parentContext) {
  goog.base(this);

  /**
   * Target DOM canvas.
   * @type {!HTMLCanvasElement}
   * @private
   */
  this.canvas_ = canvas;

  /**
   * Canvas rendering context.
   * @type {!CanvasRenderingContext2D}
   * @private
   */
  this.canvasContext2d_ = /** @type {!CanvasRenderingContext2D} */ (
      canvas.getContext('raw-2d') ||
      canvas.getContext('2d'));

  /**
   * Parent painting context.
   * If this is null then this context is the root.
   * @type {wtf.ui.PaintContext}
   * @private
   */
  this.parentContext_ = opt_parentContext || null;

  /**
   * Child painting contexts.
   * These will be repainted after their parent is.
   * @type {!Array.<!wtf.ui.PaintContext>}
   * @private
   */
  this.childContexts_ = [];

  /**
   * Whether a repaint has been requested and is pending the next frame.
   * @type {boolean}
   * @private
   */
  this.repaintPending_ = false;

  /**
   * Whether the context is ready for painting.
   * If false, the context (and all children) will not be drawn.
   * @type {boolean}
   * @private
   */
  this.ready_ = true;

  // Add to parent.
  if (this.parentContext_) {
    this.parentContext_.childContexts_.push(this);
  }
};
goog.inherits(wtf.ui.PaintContext, goog.Disposable);


/**
 * @override
 */
wtf.ui.PaintContext.prototype.disposeInternal = function() {
  goog.disposeAll(this.childContexts_);
  goog.base(this, 'disposeInternal');
};


/**
 * Gets the target canvas.
 * @return {!HTMLCanvasElement} Target canvas.
 */
wtf.ui.PaintContext.prototype.getCanvas = function() {
  return this.canvas_;
};


/**
 * Gets the canvas rendering context.
 * @return {!CanvasRenderingContext2D} Canvas rendering context.
 */
wtf.ui.PaintContext.prototype.getCanvasContext2d = function() {
  return this.canvasContext2d_;
};


/**
 * Sets the ready state of the paint context.
 * @param {boolean} value New ready value.
 */
wtf.ui.PaintContext.prototype.setReady = function(value) {
  this.ready_ = value;
  if (value) {
    this.requestRepaint();
  }
};


/**
 * Requests a repaint of the control on the next rAF.
 * This should be used instead of repainting inline in JS callbacks to help
 * the browser draw things optimally. Only call repaint directly if the results
 * *must* be displayed immediately, such as in the case of a resize.
 * @protected
 */
wtf.ui.PaintContext.prototype.requestRepaint = function() {
  if (this.parentContext_) {
    this.parentContext_.requestRepaint();
  } else if (!this.repaintPending_) {
    this.repaintPending_ = true;
    wtf.timing.deferToNextFrame(this.repaintRequested_, this);
  }
};


/**
 * Handles repaint request callbacks.
 * This is called on the edge of a new rAF.
 * @private
 */
wtf.ui.PaintContext.prototype.repaintRequested_ = function() {
  if (this.parentContext_ || !this.repaintPending_) {
    return;
  }
  this.repaintPending_ = false;
  this.repaint();
};


/**
 * Immediately repaints the controls contents.
 */
wtf.ui.PaintContext.prototype.repaint = function() {
  // Ignore requests if a child.
  if (this.parentContext_) {
    return;
  }

  // Skip all drawing if not marked ready.
  if (!this.ready_) {
    return;
  }

  // Prepare canvas. This should only occur on the root paint context.
  var ctx = this.canvasContext2d_;
  var pixelRatio = wtf.util.canvas.getCanvasPixelRatio(ctx);
  var width = this.canvas_.width / pixelRatio;
  var height = this.canvas_.height / pixelRatio;
  wtf.util.canvas.reset(ctx, pixelRatio);

  // Skip all drawing if too small.
  if (height <= 1) {
    return;
  }

  ctx.save();

  // Clear contents.
  // TODO(benvanik): only if needed
  this.clear(0, 0, width, height);

  var preventChildren = this.repaintInternal(ctx, width, height);

  ctx.restore();
  if (preventChildren) {
    return;
  }

  // Repaint all children.
  for (var n = 0; n < this.childContexts_.length; n++) {
    var childContext = this.childContexts_[n];
    ctx.save();
    childContext.repaintInternal(ctx, width, height);
    ctx.restore();
  }
};


/**
 * Repaints the context contents.
 * @param {!CanvasRenderingContext2D} ctx Canvas render context.
 * @param {number} width Canvas width, in pixels.
 * @param {number} height Canvas height, in pixels.
 * @return {boolean|undefined} True to prevent painting of children.
 * @protected
 */
wtf.ui.PaintContext.prototype.repaintInternal = goog.nullFunction;


/**
 * Clips rendering to the given rectangular region, in pixels.
 * @param {number} x X.
 * @param {number} y Y.
 * @param {number} w Width.
 * @param {number} h Height.
 * @protected
 */
wtf.ui.PaintContext.prototype.clip = function(x, y, w, h) {
  var ctx = this.canvasContext2d_;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y);
  ctx.clip();
};


/**
 * Clears the given region to the specified color.
 * @param {number} x X.
 * @param {number} y Y.
 * @param {number} w Width.
 * @param {number} h Height.
 * @param {(string|null)=} opt_color Color or null for transparent.
 */
wtf.ui.PaintContext.prototype.clear = function(x, y, w, h, opt_color) {
  var ctx = this.canvasContext2d_;
  if (!opt_color) {
    ctx.clearRect(x, y, w, h);
  } else {
    ctx.fillStyle = opt_color;
    ctx.fillRect(x, y, w, h);
  }
};
