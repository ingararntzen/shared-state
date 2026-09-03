import eventify from "./util/events.js";
import { validatePath } from "./common.js";
import { SharedStateClient } from "./client.js";

/**
 * Base class for all Layer 2 abstractions (Collections & Variables).
 */
export class BaseAbstraction {
    constructor(client, path, options) {

        if (!client || typeof client.provider !== "function") {
            throw new Error(`Client must be an instance of SharedStateClient or implement provider().`);
        }
        this._client = client;
        this._provider = client.provider(validatePath(path), options);
    }

    get path() { return this._provider.path }
    get provider() { return this._provider; }
    get client() { return this._client; }

}

eventify(BaseAbstraction.prototype);
