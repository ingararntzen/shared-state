// webpage clock - performance now - seconds
const local = {
    now: function () {
        return performance.now() / 1000.0;
    }
}
// system clock - epoch - seconds
const epoch = {
    now: function () {
        if (typeof performance !== "undefined" && typeof performance.timeOrigin === "number") {
            return (performance.timeOrigin + performance.now()) / 1000.0;
        }
        return new Date() / 1000.0;
    }
}

/**
 * CLOCK gives epoch values, but is implemented
 * using performance now for better
 * time resolution and protection against system 
 * time adjustments.
 */

export const CLOCK = function () {
    const t0_local = local.now();
    const t0_epoch = epoch.now();
    return {
        now: function () {
            const t1_local = local.now();
            return t0_epoch + (t1_local - t0_local);
        }
    };
}();


/**
 * Estimate the clock of the server 
 */

const MAX_SAMPLE_COUNT = 30;

/**
 * Server time synchronization provider calculating clock skew and network latency.
 * Access via `client.serverclock`.
 * @class ServerClock
 */
export class ServerClock {
    /**
     * Initializes a ServerClock instance.
     * @param {SharedStateClient} client - SharedState client instance
     */
    constructor(client) {
        // sharedstate client
        this._client = client;
        // pinger
        this._pinger = new Pinger(this._onping.bind(this));
        // samples
        this._samples = [];
        // estimates
        this._trans = 1000.0;
        this._skew = 0.0;
        this._latest_trans = undefined;
        this._latest_skew = undefined;
    }

    /**
     * Underlying Pinger instance.
     * @type {Object}
     * @readonly
     */
    get pinger() {
        return this._pinger;
    }

    /**
     * Restarts clock synchronization sampling.
     * @returns {void}
     */
    restart() {
        this._samples = [];
        this._trans = 1000.0;
        this._skew = 0.0;
        this._latest_trans = undefined;
        this._latest_skew = undefined;
        this._pinger.restart();
    }

    _onping() {
        const ts0 = CLOCK.now();
        const req = this._client._get ? this._client._get("/clock") : this._client.get("/clock");
        req.then(({ ok, data }) => {
            if (ok) {
                const ts1 = CLOCK.now();
                this._add_sample(ts0, data, ts1);
            }
        });
    }

    _add_sample(cs, ss, cr) {
        let trans = (cr - cs) / 2.0;
        let skew = ss - (cr + cs) / 2.0;
        this._latest_trans = trans;
        this._latest_skew = skew;

        let sample = [cs, ss, cr, trans, skew];
        // add to samples
        this._samples.push(sample)
        if (this._samples.length > MAX_SAMPLE_COUNT) {
            // remove first sample
            this._samples.shift();
        }
        // reevaluate estimates for skew and trans
        trans = 100000.0;
        skew = 0.0;
        for (const sample of this._samples) {
            if (sample[3] < trans) {
                trans = sample[3];
                skew = sample[4];
            }
        }
        this._skew = skew;
        this._trans = trans;
    }

    /**
     * Estimated clock skew relative to server in seconds.
     * @type {number}
     * @readonly
     */
    get skew() { return this._skew; }

    /**
     * Estimated minimum transit delay in seconds.
     * @type {number}
     * @readonly
     */
    get trans() { return this._trans; }

    /**
     * Latest raw ping transit delay in seconds.
     * @type {number}
     * @readonly
     */
    get latest_trans() { return this._latest_trans !== undefined ? this._latest_trans : this._trans; }

    /**
     * Latest raw ping clock skew in seconds.
     * @type {number}
     * @readonly
     */
    get latest_skew() { return this._latest_skew !== undefined ? this._latest_skew : this._skew; }

    /**
     * Estimated round trip time (RTT) in seconds.
     * @type {number}
     * @readonly
     */
    get rtt() { return this._trans * 2.0; }

    /**
     * Standard deviation of transit delay across current samples in seconds.
     * @type {number}
     * @readonly
     */
    get trans_std() {
        if (this._samples.length === 0) return 0.0;
        const vals = this._samples.map(s => s[3]);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
        return Math.sqrt(variance);
    }

    /**
     * Standard deviation of clock skew across current samples in seconds.
     * @type {number}
     * @readonly
     */
    get skew_std() {
        if (this._samples.length === 0) return 0.0;
        const vals = this._samples.map(s => s[4]);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
        return Math.sqrt(variance);
    }

    /**
     * Transit delay range (max - min) across current samples in seconds.
     * @type {number}
     * @readonly
     */
    get trans_range() {
        if (this._samples.length === 0) return 0.0;
        const vals = this._samples.map(s => s[3]);
        return Math.max(...vals) - Math.min(...vals);
    }

    /**
     * Clock skew range (max - min) across current samples in seconds.
     * @type {number}
     * @readonly
     */
    get skew_range() {
        if (this._samples.length === 0) return 0.0;
        const vals = this._samples.map(s => s[4]);
        return Math.max(...vals) - Math.min(...vals);
    }

    /**
     * Returns current estimated server time in epoch seconds (high precision).
     * @returns {number} Current estimated server timestamp in seconds
     */
    now() {
        // server clock is local clock + estimated skew
        return CLOCK.now() + this._skew;
    }

}


/*********************************************************
    PINGER
**********************************************************/

/**
 * Pinger invokes a callback repeatedly, indefinitely. 
 * Pinging in 3 stages, first frequently, then moderately, 
 * then slowly.
 */

const SMALL_DELAY = 20; // ms
const MEDIUM_DELAY = 500; // ms
const LARGE_DELAY = 1000; // ms

const DELAY_SEQUENCE = [
    ...new Array(3).fill(SMALL_DELAY),
    ...new Array(7).fill(MEDIUM_DELAY),
    ...[LARGE_DELAY]
];

class Pinger {

    constructor(callback) {
        this._count = 0;
        this._tid = undefined;
        this._callback = callback;
        this._ping = this.ping.bind(this);
        this._delays = [...DELAY_SEQUENCE];
    }
    pause() {
        clearTimeout(this._tid);
    }
    resume() {
        clearTimeout(this._tid);
        this.ping();
    }
    restart() {
        this._delays = [...DELAY_SEQUENCE];
        clearTimeout(this._tid);
        this.ping();
    }
    ping() {
        let next_delay = this._delays[0];
        if (this._delays.length > 1) {
            this._delays.shift();
        }
        if (this._callback) {
            this._callback();
        }
        this._tid = setTimeout(this._ping, next_delay);
    }
}


