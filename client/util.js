/*
    Create a promise which can be resolved
    programmatically by external code.
    Return a promise and a resolve function
*/

export function resolvablePromise() {
    let resolver;
    let promise = new Promise((resolve, reject) => {
        resolver = resolve;
    });
    return [promise, resolver];
}

export function timeoutPromise (ms) {
    let resolver;
    let promise = new Promise((resolve, reject) => {
        let tid = setTimeout(() => {
            resolve(true);
        }, ms);
        resolver = () => {
            if (tid) {
                clearTimeout(tid);
            }
            resolve(false);
        }
    });
    return [promise, resolver];
}


export function random_string(length) {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for(var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}