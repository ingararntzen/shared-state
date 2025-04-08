// webpage clock - performance now - seconds
const local = {
    now: function() {
        return performance.now()/1000.0;
    }
}
// system clock - epoch - seconds
const epoch = {
    now: function() {
        return new Date()/1000.0;
    }
}

/**
 * CLOCK gives epoch values, but is implemented
 * using performance now for better
 * time resolution and protection against system 
 * time adjustments.
 */

const CLOCK = function () {
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

export class ServerClock {

    constructor(ssclient) {
        // sharestate client
        this._ssclient = ssclient;
        // pinger
        this._pinger = new Pinger(this._onping.bind(this));
        // samples
        this._samples = [];
        // estimates
        this._trans = 1000.0;
        this._skew = 0.0;
    }

    resume() {
        this._pinger.resume();
    }

    pause() {
        this._pinger.pause();
    }

    _onping() {
        const ts0 = CLOCK.now();
        this._ssclient.get("/clock").then(({ok, data}) => {
            if (ok) {
                const ts1 = CLOCK.now();
                this._add_sample(ts0, data, ts1);    
            }
        });
    }

    _add_sample(cs, ss, cr) {
        let trans = (cr - cs) / 2.0;
        let skew = ss - (cr + cs) / 2.0;
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

    get skew() {return this._skew;}
    get trans() {return this._trans;}

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
const LARGE_DELAY = 10000; // ms

const DELAY_SEQUENCE = [
    ...new Array(3).fill(SMALL_DELAY), 
    ...new Array(7).fill(MEDIUM_DELAY),
    ...[LARGE_DELAY]
];

class Pinger {

    constructor (callback) {
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
    ping () {
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


