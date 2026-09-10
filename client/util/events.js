/**
 * @file client/util/events.js
 * @description Decoupled, state-oriented event and subscription system.
 * 
 * ============================================================================
 * OVERVIEW & USAGE
 * ============================================================================
 * 
 * `eventify` is a decorator/mixin that endows objects or class prototypes with 
 * event capabilities (`on`, `off`, `once`, `emit`).
 * 
 * Basic Usage:
 * ```js
 * import { eventify } from "./util/events.js";
 * 
 * class MyModel {
 *   constructor() {
 *     this._state = { count: 0 };
 *   }
 *   get_current_state(name) {
 *     return this._state;
 *   }
 * }
 * eventify(MyModel.prototype);
 * 
 * const model = new MyModel();
 * const handle = model.on("change", (state, eInfo) => {
 *   console.log("Current State:", state, "Is Init:", eInfo.init);
 * }, { init: true });
 * 
 * model.emit("change", { count: 1 });
 * handle.off(); // Unsubscribe via handle
 * ```
 * 
 * ============================================================================
 * REQUIREMENTS ON EVENT SOURCE IMPLEMENTATION
 * ============================================================================
 * 
 * 1. State Snapshot Method `get_current_state(name)` (Optional, for stateful objects):
 *    - If implemented, `get_current_state(name)` should return a snapshot of the current
 *      state for the given event `name`.
 *    - Allows objects to manage multiple independent state streams.
 *    - Mode 1 (Signal-only): If `get_current_state(name)` is omitted, subscribing with
 *      `options.init = true` delivers an initial event (`{ init: true }`) immediately with `eArg = undefined`.
 *    - Mode 2 (Full state payload) & Mode 3 (State diff payload): If implemented and returns a state object,
 *      `options.init = true` delivers that initial state immediately. If it returns `null`,
 *      state is considered UNINITIALIZED (EMPTY), and initial event delivery (`{ init: true }`) is
 *      automatically deferred until the first `emit(name, ...)` occurs.
 *    - Mode 4 (Regular events): Standard event subscription with `options.init = false` (default),
 *      where handlers fire only when `emit(name, ...)` is called.
 * 
 * 2. Event Batching Responsibility:
 *    - The event source is responsible for collapsing domain-level mutations 
 *      into coherent `emit(name, eArg)` calls.
 *    - The event system guarantees asynchronous decoupled execution (`Promise.resolve()`)
 *      and delivers exact, ordered handler calls for each `emit()`.
 * 
 * 3. Handler Execution Context (`this`):
 *    - Handlers default to having `this` bound to the **event source instance** (publisher).
 *    - If an observer subscriber wants `this` bound to the **observer instance**,
 *      the subscriber must bind its handler explicitly (e.g. `publisher.on("change", this.onEvent.bind(this))`)
 *      or use an arrow function `(eArg, eInfo) => this.onEvent(eArg, eInfo)`.
 *    - Callback signature: `handler(eArg, eInfo)`
 *      Where `eInfo = { src, name, count, init, handle }`.
 */

/**
 * Callback function signature invoked when an event fires.
 * Handlers default to having `this` bound to the event source instance.
 * 
 * @callback handler
 * @param {*} eArg - Event payload data (e.g. variable value or delta change object)
 * @param {EventInfo} eInfo - Event metadata object detailing source, count, and init status
 */

/**
 * Optional method implemented by stateful event sources to provide state snapshots for initial state events.
 * 
 * If implemented, `get_current_state(name)` returns the current state snapshot for the given event `name`.
 * If it returns `null`, initial state event delivery (`options.init = true`) is deferred until the first `emit(name, ...)` call occurs.
 * If not implemented on the target, subscribing with `options.init = true` delivers an initial event immediately with `eArg = undefined`.
 * 
 * @function get_current_state
 * @param {string} name - Event name string
 * @returns {*|null} Current state snapshot or null if uninitialized
 */

/**
 * Event info passed as second parameter (`eInfo`) to event callbacks.
 * @typedef {Object} EventInfo
 * @property {Object} src - Source state object emitting the event
 * @property {string} name - Event name string (e.g. "change")
 * @property {number} count - Total times this event listener has been invoked
 * @property {boolean} init - True if this is an initial state event (count === 1)
 * @property {Object} handle - Subscription handle object (supports `.off()`)
 */

class Subscription {
  constructor(eventTarget, name, callback, options = {}) {
    this.target = eventTarget;
    this.name = name;
    this.callback = callback;
    this.options = options;
    this.count = 0;
    this.terminated = false;
    this.initPending = false;
  }

  off() {
    if (this.terminated) return;
    this.terminated = true;
    if (this.target && typeof this.target.off === "function") {
      this.target.off(this);
    }
  }

  unsubscribe() {
    this.off();
  }
}

class EventManager {
  constructor(target) {
    this.target = target;
    // Map<eventName, Subscription[]>
    this.subscriptions = new Map();
    // Buffer for pending emits: [{ name, eArg }]
    this.emitBuffer = [];
    this.flushScheduled = false;
  }

  getEventSubscriptions(name) {
    let subs = this.subscriptions.get(name);
    if (!subs) {
      subs = [];
      this.subscriptions.set(name, subs);
    }
    return subs;
  }

  /**
   * Register an event handler for a named event.
   * @param {string} name - Event name (e.g. "change")
   * @param {handler} handler - Callback function invoked when event is emitted.
   * @param {Object} [options] - Subscription options
   * @param {boolean} [options.init=false] - If true, requests immediate event delivery upon subscription
   * @returns {Object} Subscription handle object (supports `.off()`)
   */
  on(name, callback, options = {}) {
    if (typeof callback !== "function") {
      throw new TypeError(`Callback must be a function, got ${typeof callback}`);
    }

    const subs = this.getEventSubscriptions(name);

    // Duplicate subscription check
    const existing = subs.find((s) => !s.terminated && s.callback === callback);
    if (existing) {
      return existing;
    }

    const sub = new Subscription(this.target, name, callback, options);
    subs.push(sub);

    // Initial state event handling
    const wantsInit = options.init === true;
    if (wantsInit) {
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
        const currentState = this.target.get_current_state(name);
        if (currentState !== null) {
          // Mode 2 / Mode 3: State is ready, schedule init delivery with state snapshot.
          sub.initPending = true;
          Promise.resolve().then(() => {
            if (sub.terminated || !sub.initPending) return;
            sub.initPending = false;

            const stateAtExec = typeof this.target.get_current_state === "function"
              ? this.target.get_current_state(name)
              : currentState;

            this._deliver(sub, stateAtExec);
          });
        } else {
          // Mode 2 / Mode 3: State is null (uninitialized).
          // Leave sub.initPending = true so the first emit delivers init.
          sub.initPending = true;
        }
      }
    }

    return sub;
  }

  /**
   * Unsubscribes an event handler using the handle object returned by `on()`.
   * @param {Object} handle - Subscription handle object returned by `on()`
   * @returns {void}
   */
  off(handle) {
    if (!handle || typeof handle !== "object") return;
    handle.terminated = true;
    const subs = this.subscriptions.get(handle.name);
    if (subs) {
      const idx = subs.indexOf(handle);
      if (idx !== -1) {
        subs.splice(idx, 1);
      }
    }
  }

  /**
   * Subscribes an event handler for a single event execution.
   * Automatically unsubscribes after the handler is invoked once.
   * @param {string} name - Event name
   * @param {handler} handler - Callback function invoked once
   * @param {Object} [options] - Subscription options
   * @param {boolean} [options.init=false] - If true, requests immediate event delivery upon subscription
   * @returns {Object} Subscription handle object (supports `.off()`)
   */
  once(name, callback, options = {}) {
    let handle;
    const wrapper = (eArg, eInfo) => {
      if (handle) {
        handle.off();
      }
      return callback.call(this.target, eArg, eInfo);
    };
    handle = this.on(name, wrapper, options);
    return handle;
  }

  /**
   * Emits an event with an event argument, to event handlers subscribed to the same event name.
   * @param {string} name - Event name (e.g. "change")
   * @param {*} eArg - Event argument that is delivered to event handlers
   * @returns {void}
   */
  emit(name, eArg) {
    this.emitBuffer.push({ name, eArg });

    if (!this.flushScheduled) {
      this.flushScheduled = true;
      Promise.resolve().then(() => {
        const buffer = this.emitBuffer;
        this.emitBuffer = [];
        this.flushScheduled = false;

        for (const item of buffer) {
          const subs = this.subscriptions.get(item.name);
          if (!subs || subs.length === 0) continue;

          // Snapshot active non-terminated subscriptions
          const targetSubs = subs.filter((sub) => !sub.terminated);
          for (const sub of targetSubs) {
            if (sub.terminated) continue;

            // If sub was waiting for init, this first emit counts as init
            sub.initPending = false;
            this._deliver(sub, item.eArg);
          }
        }
      });
    }
  }

  _deliver(sub, eArg) {
    if (sub.terminated) return;

    sub.count++;
    const eInfo = {
      src: this.target,
      name: sub.name,
      count: sub.count,
      handle: sub,
      get init() {
        return this.count === 1;
      }
    };

    try {
      sub.callback.call(this.target, eArg, eInfo);
    } catch (err) {
      console.error(`Error in event handler for "${sub.name}":`, err);
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
 * Decorates/enhances an object or class prototype with event capabilities.
 * Can be called on class prototypes (e.g. `eventify(MyClass.prototype)`) or individual instances.
 * 
 * Adds methods: `on`, `off`, `once`, `emit`.
 * 
 * @param {Object} target - The object or prototype to enhance.
 * @returns {Object} The enhanced target object.
 */
export function eventify(target) {
  if (!target) return target;

  target.on = function (name, callback, options) {
    return getManager(this).on(name, callback, options);
  };

  target.off = function (handle) {
    return getManager(this).off(handle);
  };

  target.once = function (name, callback, options) {
    return getManager(this).once(name, callback, options);
  };

  target.emit = function (name, eArg) {
    return getManager(this).emit(name, eArg);
  };

  return target;
}

export default eventify;
