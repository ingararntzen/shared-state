import { describe, test, expect, vi } from "vitest";
import { eventify } from "../../client/util/events.js";

describe("Event & Subscription System (client/util/events.js)", () => {

  test("decorator pattern adds event methods to target", () => {
    const obj = {};
    eventify(obj);

    expect(typeof obj.on_change).toBe("function");
    expect(typeof obj._emit).toBe("function");
  });

  test("decorator works on class instances", async () => {
    class MySource {
      constructor() {
        eventify(this);
      }
    }

    const src = new MySource();
    const fn = vi.fn();
    src.on_change(fn);
    src._emit("hello");

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("hello", expect.objectContaining({ count: 1 }));
  });

  test("decorator on class prototype shares methods but keeps instance event state isolated", async () => {
    class Item {
      constructor(val) {
        this.val = val;
      }
      get_current_state() {
        return this.val;
      }
    }
    eventify(Item.prototype);

    const item1 = new Item("A");
    const item2 = new Item("B");

    // Methods are shared on prototype
    expect(item1.on_change).toBe(item2.on_change);

    const fn1 = vi.fn();
    const fn2 = vi.fn();

    item1.on_change(fn1, { init: true });
    item2.on_change(fn2, { init: true });

    await Promise.resolve();

    expect(fn1).toHaveBeenCalledWith("A", expect.objectContaining({ src: item1, init: true }));
    expect(fn2).toHaveBeenCalledWith("B", expect.objectContaining({ src: item2, init: true }));

    // Emitting on item1 only affects item1
    item1.val = "A_updated";
    item1._emit("A_updated");

    await Promise.resolve();

    expect(fn1).toHaveBeenCalledTimes(2);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test("Mode 1: behavior when target does not implement get_current_state()", async () => {
    const src = eventify({}); // No get_current_state method (Mode 1: signal-only)
    const fnInit = vi.fn();
    const fnNormal = vi.fn();

    // Subscribe with init: true (Mode 1: delivers immediately with undefined changes)
    src.on_change(fnInit, { init: true });
    // Subscribe with init: false (Mode 4: regular event, fires on _emit)
    src.on_change(fnNormal, { init: false });

    await Promise.resolve();
    
    // Mode 1: fnInit fires immediately with undefined changes and init: true
    expect(fnInit).toHaveBeenCalledTimes(1);
    expect(fnInit).toHaveBeenCalledWith(undefined, expect.objectContaining({ count: 1, init: true }));
    expect(fnNormal).not.toHaveBeenCalled();

    // Emitting event
    src._emit("payload1");

    await Promise.resolve();

    // Second event for fnInit (count === 2, init === false)
    expect(fnInit).toHaveBeenCalledTimes(2);
    expect(fnInit).toHaveBeenLastCalledWith("payload1", expect.objectContaining({ count: 2, init: false }));

    // First event for fnNormal (count === 1, init === true)
    expect(fnNormal).toHaveBeenCalledTimes(1);
    expect(fnNormal).toHaveBeenCalledWith("payload1", expect.objectContaining({ count: 1, init: true }));
  });

  test("unsubscribe via sub.cancel()", async () => {
    const target = eventify({});
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const sub1 = target.on_change(fn1);
    const sub2 = target.on_change(fn2);

    sub1.cancel();
    sub2.cancel();

    target._emit(42);
    await Promise.resolve();

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  test("same handler on multiple event sources tells sources apart via eInfo.src and this", async () => {
    const srcA = eventify({ name: "SourceA" });
    const srcB = eventify({ name: "SourceB" });

    const calls = [];
    function handler(changes, eInfo) {
      calls.push({
        changes,
        srcInInfo: eInfo.src,
        contextThis: this
      });
    }

    srcA.on_change(handler);
    srcB.on_change(handler);

    srcA._emit("valA");
    srcB._emit("valB");

    await Promise.resolve();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      changes: "valA",
      srcInInfo: srcA,
      contextThis: srcA
    });
    expect(calls[1]).toEqual({
      changes: "valB",
      srcInInfo: srcB,
      contextThis: srcB
    });
  });

  test("two handlers on a single event source", async () => {
    const src = eventify({});
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    src.on_change(fn1);
    src.on_change(fn2);

    src._emit({ ok: true });
    await Promise.resolve();

    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(fn1).toHaveBeenCalledWith({ ok: true }, expect.objectContaining({ count: 1 }));
    expect(fn2).toHaveBeenCalledWith({ ok: true }, expect.objectContaining({ count: 1 }));
  });

  test("immediate subscribe and synchronous unsubscribe prevents handler call", async () => {
    class Stateful {
      constructor() {
        eventify(this);
      }
      get_current_state() {
        return { count: 10 };
      }
    }

    const src = new Stateful();
    const fn = vi.fn();

    const sub = src.on_change(fn, { init: true });
    // Synchronously unsubscribe right after subscribe
    sub.cancel();

    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });

  test("init: true delivers initial state via get_current_state()", async () => {
    class Stateful {
      constructor() {
        eventify(this);
        this.counter = 5;
      }
      get_current_state() {
        return this.counter;
      }
    }

    const src = new Stateful();
    const fn = vi.fn();

    src.on_change(fn, { init: true });

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5, expect.objectContaining({ count: 1, init: true }));

    // Emit subsequent update
    src.counter = 6;
    src._emit(6);

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(6, expect.objectContaining({ count: 2, init: false }));
  });

  test("deferred init delivery when state is null (NOT INITIALIZED)", async () => {
    class DynamicState {
      constructor() {
        eventify(this);
        this.ready = false;
        this.data = null;
      }
      get_current_state() {
        return this.ready ? this.data : null;
      }
    }

    const src = new DynamicState();
    const fn = vi.fn();

    // Subscribe when state is uninitialized (null)
    src.on_change(fn, { init: true });

    await Promise.resolve();
    // Should NOT have received init event yet
    expect(fn).not.toHaveBeenCalled();

    // Now initialize object and emit first event
    src.ready = true;
    src.data = { items: [1, 2, 3] };
    src._emit(src.data);

    await Promise.resolve();

    // First _emit acts as the init event!
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ items: [1, 2, 3] }, expect.objectContaining({ count: 1, init: true }));
  });

  test("microtask batching of _emit calls", async () => {
    const src = eventify({});
    const fn = vi.fn();

    src.on_change(fn);

    src._emit("step1");
    src._emit("step2");

    // Before microtask runs, fn should not have been called synchronously
    expect(fn).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "step1", expect.objectContaining({ count: 1 }));
    expect(fn).toHaveBeenNthCalledWith(2, "step2", expect.objectContaining({ count: 2 }));
  });

  test("duplicate subscription prevention", () => {
    const src = eventify({});
    const fn = vi.fn();

    const sub1 = src.on_change(fn);
    const sub2 = src.on_change(fn);

    expect(sub1).toBe(sub2);
  });

  test("{ once: true } option cancels subscription after first execution", async () => {
    const src = eventify({});
    const fn = vi.fn();

    src.on_change(fn, { once: true });

    src._emit(1);
    src._emit(2);

    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1, expect.objectContaining({ count: 1 }));
  });

  test("{ once: true } with init: true delivers init and cancels", async () => {
    class Stateful {
      constructor() {
        eventify(this);
      }
      get_current_state() {
        return "initial";
      }
    }

    const src = new Stateful();
    const fn = vi.fn();

    src.on_change(fn, { init: true, once: true });

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("initial", expect.objectContaining({ count: 1, init: true }));

    // Subsequent _emit should NOT trigger fn
    src._emit("next");
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

});
