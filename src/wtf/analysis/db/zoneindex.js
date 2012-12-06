/**
 * Copyright 2012 Google, Inc. All Rights Reserved.
 *
 * Use of this source code is governed by a BSD-style license that can be
 * found in the LICENSE file.
 */

/**
 * @fileoverview Zone-based index.
 *
 * @author benvanik@google.com (Ben Vanik)
 */

goog.provide('wtf.analysis.db.ZoneIndex');

goog.require('wtf.analysis.ScopeEvent');
goog.require('wtf.analysis.db.EventList');



/**
 * An in-memory index of events by the zone they occur in.
 *
 * @param {!wtf.analysis.TraceListener} traceListener Trace listener.
 * @param {!wtf.analysis.Zone} zone Zone this index matches.
 * @constructor
 * @extends {wtf.analysis.db.EventList}
 */
wtf.analysis.db.ZoneIndex = function(traceListener, zone) {
  goog.base(this);

  /**
   * Zone this index is matching.
   * @type {!wtf.analysis.Zone}
   * @private
   */
  this.zone_ = zone;

  // Hacky, but stash the well-known event types that we will be comparing
  // with to dramatically improve performance.
  /**
   * Lookup for common event types.
   * @type {!Object.<wtf.analysis.EventType>}
   * @private
   */
  this.eventTypes_ = {
    scopeLeave: traceListener.getEventType('wtf.scope.leave')
  };

  /**
   * The current open scope inside of an insertion block.
   * This is used to quickly append scopes while streaming in-order.
   * It is cleared when the scope depth reaches zero or a batch ends. If it is
   * not set then an event insert should search to find the right scope (it may
   * be out of order).
   * @type {wtf.analysis.Scope}
   * @private
   */
  this.currentScope_ = null;

  /**
   * The time of the last event added in-order.
   * @type {number}
   * @private
   */
  this.lastAddEventTime_ = 0;

  /**
   * A list of out-of-order adds in the current batch.
   * This will have their scopes set properly at batch end.
   * @type {!Array.<!wtf.analysis.Event>}
   * @private
   */
  this.pendingOutOfOrderEvents_ = [];
};
goog.inherits(wtf.analysis.db.ZoneIndex, wtf.analysis.db.EventList);


/**
 * Gets the zone this index is matching.
 * @return {!wtf.analysis.Zone} Zone.
 */
wtf.analysis.db.ZoneIndex.prototype.getZone = function() {
  return this.zone_;
};


/**
 * @override
 */
wtf.analysis.db.ZoneIndex.prototype.beginInserting = function() {
  wtf.analysis.db.EventList.prototype.beginInserting.call(this);
  this.currentScope_ = null;
  this.lastAddEventTime_ = this.getLastEventTime();
};


/**
 * @override
 */
wtf.analysis.db.ZoneIndex.prototype.insertEvent = function(e) {
  if (e.zone == this.zone_) {
    // Here be dragons...
    // This attempts to insert scopes fast (by looking at the current scope)
    // while also supported out-of-order adds to existing scopes by queuing them
    // for later.
    if (e.time < this.lastAddEventTime_) {
      // Event is out of order - add to the pending list.
      this.pendingOutOfOrderEvents_.push(e);
    } else {
      this.lastAddEventTime_ = e.time;
      if (e instanceof wtf.analysis.ScopeEvent) {
        // Scope enter event.
        if (this.currentScope_) {
          this.currentScope_.addChild(
              /** @type {!wtf.analysis.Scope} */ (e.scope));
        }
        this.currentScope_ = e.scope;
      } else if (e.eventType == this.eventTypes_.scopeLeave) {
        // Scope leave event.
        // Leaves the current scope, if any. Unmatched leaves are ignored.
        e.setScope(this.currentScope_);
        if (this.currentScope_) {
          this.currentScope_.setLeaveEvent(e);
          this.currentScope_ = this.currentScope_.getParent();
        }
      } else {
        // Attach the event to the current scope.
        if (this.currentScope_) {
          e.setScope(this.currentScope_);
        }
      }
    }

    // We manually call base method instead of using goog.base because this
    // method is called often enough to have a major impact on load time
    // in debug mode.
    wtf.analysis.db.EventList.prototype.insertEvent.call(this, e);
  }
};


/**
 * @override
 */
wtf.analysis.db.ZoneIndex.prototype.endInserting = function() {
  this.currentScope_ = null;

  // Process out-of-order events.
  // TODO(benvanik): a more generalized solution that handles reverse lists.
  var currentScope = null;
  for (var n = 0; n < this.pendingOutOfOrderEvents_.length; n++) {
    var e = this.pendingOutOfOrderEvents_[n];
    if (e instanceof wtf.analysis.ScopeEvent) {
      var parentScope = this.findEnclosingScope(e.time);
      if (parentScope) {
        parentScope.addChild(
            /** @type {!wtf.analysis.Scope} */ (e.scope));
      }
      currentScope = e.scope;
    } else if (e.eventType == this.eventTypes_.scopeLeave) {
      e.setScope(currentScope);
      if (currentScope) {
        currentScope.setLeaveEvent(e);
        currentScope = null;
      }
    } else {
      e.setScope(currentScope);
    }
  }
  this.pendingOutOfOrderEvents_.length = 0;

  wtf.analysis.db.EventList.prototype.endInserting.call(this);
};
