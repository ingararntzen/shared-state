/**
 * The `eventify` decorator can be used on objects or class prototype objects
 * in order to imbue the target object with single-channel state change event capabilities.
 * @module Events
 */

/*
 * ============================================================================
 * OVERVIEW & USAGE
 * ============================================================================
 *
 * `eventify` is a decorator/mixin that endows objects or class prototypes with
 * state change notification capabilities (`on_change`, `_emit`).
 *
 * Each eventified object represents a single event channel signalling that its
 * state has changed.
 *
 * Basic Usage:
 * ```js
 * import { eventify } from "./util/events.js";
 *
 * class MyModel {
 *   constructor() {
 *     this._state = { count: 0 };
 *   }
 *   get_current_state() {
 *     return this._state;
 *   }
 *   set_count(count) {
 *     this._state = { count };
 *     this._emit(this._state);
 *   }
 * }
 * eventify(MyModel.prototype);
 *
 * const model = new MyModel();
 * const sub = model.on_change((state, eInfo) => {
 *   console.log("Current State:", state, "Is Init:", eInfo.init);
 * }, { init: true });
 *
 * model.set_count(1);
 * sub.cancel(); // Unsubscribe via subscription handle
 * ```
 *
 * ============================================================================
 * REQUIREMENTS ON EVENT SOURCE IMPLEMENTATION
 * ============================================================================
 *
 * 1. State Snapshot Method `get_current_state()` (Optional, for stateful objects):
 *    - If implemented, `get_current_state()` should return a snapshot of the
 *      object's current state.
 *    - Mode 1 (Signal-only): If `get_current_state()` is omitted, subscribing with
 *      `options.init = true` delivers an initial event (`{ init: true }`) immediately
 *      via microtask with `eArg = undefined`.
 *    - Mode 2 (Full state payload) & Mode 3 (State diff payload): If implemented and
 *      returns a non-null state value, `options.init = true` delivers that initial
 *      state immediately via microtask. If it returns `null`, the state is considered
 *      UNINITIALIZED (EMPTY), and initial event delivery (`{ init: true }`) is
 *      automatically deferred until the first `_emit(...)` call occurs.
 *    - Mode 4 (Regular events): Standard subscription with `options.init = false` (default),
 *      where handlers fire only when `_emit(...)` is called.
 *
 * 2. One-Shot Subscriptions (`options.once = true`):
 *    - Passing `{ once: true }` automatically cancels the subscription (`sub.cancel()`)
 *      upon its first delivery (whether triggered by `{ init: true }` or `_emit()`).
 *
 * 3. Event Batching Responsibility:
 *    - The event source is responsible for collapsing domain-level mutations
 *      into coherent `_emit(eArg)` calls.
 *    - The event system guarantees asynchronous decoupled execution (`Promise.resolve()`)
 *      and delivers exact, ordered handler calls for each `_emit()`.
 *
 * 4. Handler Execution Context (`this`):
 *    - Handlers default to having `this` bound to the **event source instance** (publisher).
 *    - If an observer wants `this` bound to the **observer instance**,
 *      the subscriber must bind its handler explicitly (e.g. `publisher.on_change(this.onEvent.bind(this))`)
 *      or use an arrow function `(eArg, eInfo) => this.onEvent(eArg, eInfo)`.
 *    - Handler signature: `handler(changes, eInfo)`
 *      Where `eInfo = { src, count, init, sub }`.
 */

/**
 * Handler function signature invoked when a state change event is emitted.
 * Handlers default to having `this` bound to the event source instance.
 *
 * @callback handler
 * @param {*} changes - State changes payload (e.g. `{ insert, remove, reset }` for collections or `{ new, old }` for variables)
 * @param {EventInfo} eInfo - Event metadata object detailing source, count, init status, and subscription handle
 */

/**
 * Optional method implemented by stateful event sources to provide state snapshots for initial state events.
 *
 * This method is not provided by the decorator, and must therefore be manually implemented.
 *
 * If implemented, `get_current_state()` returns the current state snapshot.
 * If it returns `null`, initial state event delivery (`options.init = true`) is deferred until the first `_emit(...)` call occurs.
 * If not implemented, subscribing with `options.init = true` delivers an initial event with `changes = undefined`.
 *
 * @function get_current_state
 * @returns {*|null} Current state of the object, or null if uninitialized
 */

/**
 * Event info passed as second parameter (`eInfo`) to event handlers.
 * @typedef {Object} EventInfo
 * @property {Object} src - Object emitting the event
 * @property {number} count - Total times this event handler has been invoked
 * @property {boolean} init - True if this is an initial state event (count === 1)
 * @property {Subscription} sub - Subscription handle object (supports `.cancel()`)
 */

class Subscription {
  constructor(manager, callback, options = {}) {
    this._manager = manager;
    this.callback = callback;
    this.init = options.init === true;
    this.once = options.once === true;
    this.count = 0;
    this.terminated = false;
    this.initPending = false;
  }

  /**
   * Cancels this subscription so the handler will no longer be invoked.
   * Safe to call multiple times or prior to initial microtask delivery.
   * @returns {void}
   */
  cancel() {
    if (this.terminated) return;
    this.terminated = true;
    this.initPending = false;
    if (this._manager) {
      this._manager._remove(this);
    }
  }
}

class EventManager {
  constructor(target) {
    this.target = target;
    // Active subscriptions: Subscription[]
    this.subscriptions = [];
    // Buffer for pending emits: eArg[]
    this.emitBuffer = [];
    this.flushScheduled = false;
  }

  /**
   * Register an event handler for state changes on this object.
   * @param {handler} handler - Handler function invoked when state changes
   * @param {Object} [options] - Subscription options
   * @param {boolean} [options.init=false] - If true, requests immediate initial state delivery upon subscription
   * @param {boolean} [options.once=false] - If true, automatically cancels the subscription after its first invocation
   * @returns {Subscription} Subscription handle object (supports `.cancel()`)
   */
  on_change(handler, options = {}) {
    if (typeof handler !== "function") {
      throw new TypeError(`Handler must be a function, got ${typeof handler}`);
    }

    // Duplicate subscription check
    const existing = this.subscriptions.find((s) => !s.terminated && s.callback === handler);
    if (existing) {
      return existing;
    }

    const sub = new Subscription(this, handler, options);
    this.subscriptions.push(sub);

    // Initial state event handling
    if (sub.init) {
      const hasGetState = typeof this.target.get_current_state === "function";

      if (!hasGetState) {
        // Mode 1: Signal-only state source (no get_current_state method defined).
        // Immediately schedule initial state event delivery with eArg = undefined.
        sub.initPending = true;
        Promise.resolve().then(() => {
          if (sub.terminated || !sub.initPending) return;
          sub.initPending = false;
          this._deliver(sub, undefined);
        });
      } else {
        const currentState = this.target.get_current_state();
        if (currentState !== null) {
          // Mode 2 / Mode 3: State is ready, schedule init delivery with state snapshot.
          sub.initPending = true;
          Promise.resolve().then(() => {
            if (sub.terminated || !sub.initPending) return;
            sub.initPending = false;

            const stateAtExec = typeof this.target.get_current_state === "function"
              ? this.target.get_current_state()
              : currentState;

            this._deliver(sub, stateAtExec);
          });
        } else {
          // Mode 2 / Mode 3: State is null (uninitialized).
          // Leave sub.initPending = true so the first _emit delivers init.
          sub.initPending = true;
        }
      }
    }

    return sub;
  }

  /**
   * Internal helper to remove a cancelled subscription from the active list.
   * @param {Subscription} sub
   * @private
   */
  _remove(sub) {
    const idx = this.subscriptions.indexOf(sub);
    if (idx !== -1) {
      this.subscriptions.splice(idx, 1);
    }
  }

  /**
   * Emits a state change event with an optional payload argument to subscribed handlers.
   * Intended to be called internally by the event source (`this._emit(changes)`).
   *
   * @param {*} [changes] - Optional state changes payload delivered to handlers
   * @returns {void}
   */
  _emit(changes = undefined) {
    this.emitBuffer.push(changes);

    if (!this.flushScheduled) {
      this.flushScheduled = true;
      Promise.resolve().then(() => {
        const buffer = this.emitBuffer;
        this.emitBuffer = [];
        this.flushScheduled = false;

        for (const itemChanges of buffer) {
          if (this.subscriptions.length === 0) continue;

          // Snapshot active non-terminated subscriptions
          const targetSubs = this.subscriptions.filter((sub) => !sub.terminated);
          for (const sub of targetSubs) {
            if (sub.terminated) continue;

            // If sub was waiting for init, this first _emit counts as init
            sub.initPending = false;
            this._deliver(sub, itemChanges);
          }
        }
      });
    }
  }

  _deliver(sub, eArg) {
    if (sub.terminated) return;

    if (sub.once) {
      sub.cancel();
    }

    sub.count++;
    const eInfo = {
      src: this.target,
      count: sub.count,
      sub: sub,
      get init() {
        return this.count === 1;
      }
    };

    try {
      sub.callback.call(this.target, eArg, eInfo);
    } catch (err) {
      console.error("Error in on_change handler:", err);
    }
  }
}

const MANAGER_KEY = "__events_manager__";

function getManager(obj) {
  if (!Object.prototype.hasOwnProperty.call(obj, MANAGER_KEY)) {
    Object.defineProperty(obj, MANAGER_KEY, {
      value: new EventManager(obj),
      writable: false,
      configurable: true,
      enumerable: false
    });
  }
  return obj[MANAGER_KEY];
}

/**
 * Decorates/enhances an object or class prototype with state change event capabilities.
 * Can be called on class prototypes (e.g. `eventify(MyClass.prototype)`) or individual instances.
 *
 * Adds methods: `on_change`, `_emit`.
 *
 * @param {Object} target - The object or prototype to enhance.
 * @returns {Object} The enhanced target object.
 */
export function eventify(target) {
  if (!target) return target;

  target.on_change = function (handler, options) {
    return getManager(this).on_change(handler, options);
  };

  target._emit = function (changes = undefined) {
    return getManager(this)._emit(changes);
  };

  return target;
}

export default eventify;
