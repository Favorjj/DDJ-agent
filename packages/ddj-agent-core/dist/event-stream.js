/**
 * Simple push-based event stream for agent events.
 */
export class EventStream {
    listeners = [];
    ended = false;
    resultPromise;
    resolveResult;
    isEnd;
    getReturn;
    constructor(isEnd, getReturn) {
        this.isEnd = isEnd;
        this.getReturn = getReturn;
        this.resultPromise = new Promise((resolve) => {
            this.resolveResult = resolve;
        });
    }
    push(event) {
        if (this.ended)
            return;
        for (const l of this.listeners) {
            try {
                const r = l(event);
                if (r instanceof Promise)
                    r.catch(() => { });
            }
            catch { }
        }
        if (this.isEnd(event)) {
            this.ended = true;
            this.resolveResult(this.getReturn(event));
        }
    }
    end(value) {
        if (this.ended)
            return;
        this.ended = true;
        this.resolveResult(value);
    }
    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }
    /** Wait for the stream to end and get the final return value */
    wait() {
        return this.resultPromise;
    }
    /** Subscribe and wait for end */
    async collect() {
        return this.wait();
    }
}
//# sourceMappingURL=event-stream.js.map