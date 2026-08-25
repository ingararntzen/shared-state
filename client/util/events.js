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
 *   get_state(name) {
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
 * 1. State Snapshot Method `get_state(name)` (Optional, for stateful objects):
 *    - If implemented, `get_state(name)` should return a snapshot of the current
 *      state for the given event `name`.
 *    - Allows objects to manage multiple independent state streams.
 *    - If `get_state(name)` returns `null` (or is omitted), the state is considered
 *      UNINITIALIZED (EMPTY). Initial state event delivery (`{ init: true }`) is 
 *      automatically deferred until the first `emit(name, ...)` occurs.
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
      const currentState = typeof this.target.get_state === "function"
        ? this.target.get_state(name)
        : null;

      if (currentState !== null) {
        // State is initialized, schedule init delivery
        sub.initPending = true;
        Promise.resolve().then(() => {
          if (sub.terminated || !sub.initPending) return;
          sub.initPending = false;
          
          // Re-check state at execution time
          const stateAtExec = typeof this.target.get_state === "function"
            ? this.target.get_state(name)
            : currentState;
            
          this._deliver(sub, stateAtExec);
        });
      } else {
        // State is null or target lacks get_state().
        // Leave sub.initPending = true so the first emit delivers init.
        sub.initPending = true;
      }
    }

    return sub;
  }

  off(handleOrName, callback) {
    if (!handleOrName) return;

    if (typeof handleOrName === "object" && handleOrName !== null) {
      // Unsubscribe via Subscription handle
      const sub = handleOrName;
      sub.terminated = true;
      const subs = this.subscriptions.get(sub.name);
      if (subs) {
        const idx = subs.indexOf(sub);
        if (idx !== -1) {
          subs.splice(idx, 1);
        }
      }
      return;
    }

    if (typeof handleOrName === "string") {
      const name = handleOrName;
      const subs = this.subscriptions.get(name);
      if (!subs) return;

      if (typeof callback === "function") {
        // Remove specific callback
        for (let i = subs.length - 1; i >= 0; i--) {
          if (subs[i].callback === callback) {
            subs[i].terminated = true;
            subs.splice(i, 1);
          }
        }
      } else {
        // Remove all callbacks for event name
        for (const sub of subs) {
          sub.terminated = true;
        }
        this.subscriptions.set(name, []);
      }
    }
  }

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

  target.off = function (handleOrName, callback) {
    return getManager(this).off(handleOrName, callback);
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
