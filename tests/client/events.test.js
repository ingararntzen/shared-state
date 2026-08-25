import { describe, test, expect, vi } from "vitest";
import { eventify } from "../../client/util/events.js";

describe("Event & Subscription System (client/util/events.js)", () => {

  test("decorator pattern adds event methods to target", () => {
    const obj = {};
    eventify(obj);

    expect(typeof obj.on).toBe("function");
    expect(typeof obj.off).toBe("function");
    expect(typeof obj.once).toBe("function");
    expect(typeof obj.emit).toBe("function");
  });

  test("decorator works on class instances", async () => {
    class MySource {
      constructor() {
        eventify(this);
      }
    }

    const src = new MySource();
    const fn = vi.fn();
    src.on("change", fn);
    src.emit("change", "hello");

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("hello", expect.objectContaining({ name: "change", count: 1 }));
  });

  test("decorator on class prototype shares methods but keeps instance event state isolated", async () => {
    class Item {
      constructor(val) {
        this.val = val;
      }
      get_state(name) {
        return this.val;
      }
    }
    eventify(Item.prototype);

    const item1 = new Item("A");
    const item2 = new Item("B");

    // Methods are shared on prototype
    expect(item1.on).toBe(item2.on);

    const fn1 = vi.fn();
    const fn2 = vi.fn();

    item1.on("change", fn1, { init: true });
    item2.on("change", fn2, { init: true });

    await Promise.resolve();

    expect(fn1).toHaveBeenCalledWith("A", expect.objectContaining({ src: item1, init: true }));
    expect(fn2).toHaveBeenCalledWith("B", expect.objectContaining({ src: item2, init: true }));

    // Emitting on item1 only affects item1
    item1.val = "A_updated";
    item1.emit("change", "A_updated");

    await Promise.resolve();

    expect(fn1).toHaveBeenCalledTimes(2);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test("behavior when target does not implement get_state()", async () => {
    const src = eventify({}); // No get_state method
    const fnInit = vi.fn();
    const fnNormal = vi.fn();

    // Subscribe with init: true
    src.on("ping", fnInit, { init: true });
    src.on("ping", fnNormal, { init: false });

    await Promise.resolve();
    // Neither should have fired yet
    expect(fnInit).not.toHaveBeenCalled();
    expect(fnNormal).not.toHaveBeenCalled();

    // Emitting first event
    src.emit("ping", "payload1");

    await Promise.resolve();

    // First emit acts as init for fnInit (count === 1, init === true)
    expect(fnInit).toHaveBeenCalledTimes(1);
    expect(fnInit).toHaveBeenCalledWith("payload1", expect.objectContaining({ count: 1, init: true }));

    expect(fnNormal).toHaveBeenCalledTimes(1);
    expect(fnNormal).toHaveBeenCalledWith("payload1", expect.objectContaining({ count: 1, init: true }));

    // Second emit
    src.emit("ping", "payload2");

    await Promise.resolve();

    expect(fnInit).toHaveBeenCalledTimes(2);
    expect(fnInit).toHaveBeenLastCalledWith("payload2", expect.objectContaining({ count: 2, init: false }));
  });

  test("unsubscribe via handle.off() vs target.off(handle)", async () => {
    const target = eventify({});
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    const handle1 = target.on("data", fn1);
    const handle2 = target.on("data", fn2);

    handle1.off();
    target.off(handle2);

    target.emit("data", 42);
    await Promise.resolve();

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).not.toHaveBeenCalled();
  });

  test("same handler on multiple event sources tells sources apart via eInfo.src and this", async () => {
    const srcA = eventify({ name: "SourceA" });
    const srcB = eventify({ name: "SourceB" });

    const calls = [];
    function handler(eArg, eInfo) {
      calls.push({
        eArg,
        srcInInfo: eInfo.src,
        contextThis: this
      });
    }

    srcA.on("update", handler);
    srcB.on("update", handler);

    srcA.emit("update", "valA");
    srcB.emit("update", "valB");

    await Promise.resolve();

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      eArg: "valA",
      srcInInfo: srcA,
      contextThis: srcA
    });
    expect(calls[1]).toEqual({
      eArg: "valB",
      srcInInfo: srcB,
      contextThis: srcB
    });
  });

  test("two handlers on a single event source", async () => {
    const src = eventify({});
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    src.on("event", fn1);
    src.on("event", fn2);

    src.emit("event", { ok: true });
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
      get_state(name) {
        return { count: 10 };
      }
    }

    const src = new Stateful();
    const fn = vi.fn();

    const handle = src.on("change", fn, { init: true });
    // Synchronously unsubscribe right after subscribe
    handle.off();

    await Promise.resolve();
    expect(fn).not.toHaveBeenCalled();
  });

  test("init: true delivers initial state via get_state(name)", async () => {
    class Stateful {
      constructor() {
        eventify(this);
        this.counter = 5;
      }
      get_state(name) {
        if (name === "counter") return this.counter;
        return null;
      }
    }

    const src = new Stateful();
    const fn = vi.fn();

    src.on("counter", fn, { init: true });

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(5, expect.objectContaining({ count: 1, init: true }));

    // Emit subsequent update
    src.counter = 6;
    src.emit("counter", 6);

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
      get_state(name) {
        return this.ready ? this.data : null;
      }
    }

    const src = new DynamicState();
    const fn = vi.fn();

    // Subscribe when state is uninitialized (null)
    src.on("state", fn, { init: true });

    await Promise.resolve();
    // Should NOT have received init event yet
    expect(fn).not.toHaveBeenCalled();

    // Now initialize object and emit first event
    src.ready = true;
    src.data = { items: [1, 2, 3] };
    src.emit("state", src.data);

    await Promise.resolve();

    // First emit acts as the init event!
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ items: [1, 2, 3] }, expect.objectContaining({ count: 1, init: true }));
  });

  test("microtask batching of emit calls", async () => {
    const src = eventify({});
    const fn = vi.fn();

    src.on("stream", fn);

    src.emit("stream", "step1");
    src.emit("stream", "step2");

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

    const handle1 = src.on("click", fn);
    const handle2 = src.on("click", fn);

    expect(handle1).toBe(handle2);
  });

  test(".once() unsubscribes after first execution", async () => {
    const src = eventify({});
    const fn = vi.fn();

    src.once("tick", fn);

    src.emit("tick", 1);
    src.emit("tick", 2);

    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1, expect.objectContaining({ count: 1 }));
  });

  test(".once() with init: true delivers init and unsubscribes", async () => {
    class Stateful {
      constructor() {
        eventify(this);
      }
      get_state(name) {
        return "initial";
      }
    }

    const src = new Stateful();
    const fn = vi.fn();

    src.once("change", fn, { init: true });

    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("initial", expect.objectContaining({ count: 1, init: true }));

    // Subsequent emit should NOT trigger fn
    src.emit("change", "next");
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("get_state(name) supports multiple independent event states", async () => {
    class MultiState {
      constructor() {
        eventify(this);
        this.foo = "foo_state";
        this.bar = "bar_state";
      }
      get_state(name) {
        if (name === "foo") return this.foo;
        if (name === "bar") return this.bar;
        return null;
      }
    }

    const src = new MultiState();
    const fnFoo = vi.fn();
    const fnBar = vi.fn();

    src.on("foo", fnFoo, { init: true });
    src.on("bar", fnBar, { init: true });

    await Promise.resolve();

    expect(fnFoo).toHaveBeenCalledWith("foo_state", expect.objectContaining({ name: "foo", init: true }));
    expect(fnBar).toHaveBeenCalledWith("bar_state", expect.objectContaining({ name: "bar", init: true }));
  });

  test("target.off('name', callback) and target.off('name')", async () => {
    const src = eventify({});
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    src.on("tick", fn1);
    src.on("tick", fn2);

    // Remove specific callback
    src.off("tick", fn1);
    src.emit("tick", 1);
    await Promise.resolve();

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledTimes(1);

    // Remove all callbacks for event name
    src.off("tick");
    src.emit("tick", 2);
    await Promise.resolve();

    expect(fn2).toHaveBeenCalledTimes(1);
  });

});
