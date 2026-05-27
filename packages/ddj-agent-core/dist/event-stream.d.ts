/**
 * Simple push-based event stream for agent events.
 */
type Listener<T> = (event: T) => void | Promise<void>;
export declare class EventStream<T, R> {
    private listeners;
    private ended;
    private resultPromise;
    private resolveResult;
    private isEnd;
    private getReturn;
    constructor(isEnd: (event: T) => boolean, getReturn: (event: T) => R);
    push(event: T): void;
    end(value: R): void;
    subscribe(listener: Listener<T>): () => void;
    /** Wait for the stream to end and get the final return value */
    wait(): Promise<R>;
    /** Subscribe and wait for end */
    collect(): Promise<R>;
}
export {};
//# sourceMappingURL=event-stream.d.ts.map