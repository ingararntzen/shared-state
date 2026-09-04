import { describe, test, expect, vi } from "vitest";
import { ServerClock } from "../../client/server_clock.js";

describe("ServerClock Unit Tests", () => {
    function createMockClient() {
        return {
            get: vi.fn().mockResolvedValue({ ok: true, data: Date.now() / 1000 })
        };
    }

    test("initial estimates", () => {
        const mockClient = createMockClient();
        const clock = new ServerClock(mockClient);

        expect(clock.rtt).toBe(2000.0);
        expect(clock.skew).toBe(0.0);
        expect(typeof clock.now()).toBe("number");
    });

    test("add_sample calculates transit delay and skew correctly", () => {
        const mockClient = createMockClient();
        const clock = new ServerClock(mockClient);

        // cs = 10.0 (client send), ss = 10.5 (server received/responded), cr = 10.2 (client receive)
        // round trip = cr - cs = 0.2s
        // transit = 0.1s
        // estimated server time at midpoint (10.1) = 10.5 -> skew = 10.5 - 10.1 = 0.4
        clock._add_sample(10.0, 10.5, 10.2);

        expect(clock.rtt).toBeCloseTo(0.2);
        expect(clock.skew).toBeCloseTo(0.4);
    });

    test("pinger controls pause, resume, and restart", () => {
        const mockClient = createMockClient();
        const clock = new ServerClock(mockClient);

        expect(() => {
            clock.pinger.pause();
            clock.pinger.resume();
            clock.restart();
            clock.pinger.pause();
        }).not.toThrow();
    });

    test("computes variance and range metrics across samples", () => {
        const mockClient = createMockClient();
        const clock = new ServerClock(mockClient);

        // sample 1: cs=10.0, ss=10.5, cr=10.2 -> trans=0.1, skew=0.4
        clock._add_sample(10.0, 10.5, 10.2);
        // sample 2: cs=10.0, ss=10.7, cr=10.4 -> trans=0.2, skew=0.5
        clock._add_sample(10.0, 10.7, 10.4);

        expect(clock.trans_range).toBeCloseTo(0.1);
        expect(clock.skew_range).toBeCloseTo(0.1);
        expect(clock.trans_std).toBeGreaterThan(0);
        expect(clock.skew_std).toBeGreaterThan(0);
    });
});
