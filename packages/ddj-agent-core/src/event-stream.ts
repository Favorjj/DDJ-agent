/**
 * Simple push-based event stream for agent events.
 */

type Listener<T> = (event: T) => void | Promise<void>;

export class EventStream<T, R> {
  private listeners: Listener<T>[] = [];
  private ended = false;
  private resultPromise: Promise<R>;
  private resolveResult!: (value: R) => void;
  private isEnd: (event: T) => boolean;
  private getReturn: (event: T) => R;

  constructor(isEnd: (event: T) => boolean, getReturn: (event: T) => R) {
    this.isEnd = isEnd;
    this.getReturn = getReturn;
    this.resultPromise = new Promise<R>((resolve) => {
      this.resolveResult = resolve;
    });
  }

  push(event: T): void {
    if (this.ended) return;
    for (const l of this.listeners) {
      try {
        const r = l(event);
        if (r instanceof Promise) r.catch(() => {});
      } catch {}
    }
    if (this.isEnd(event)) {
      this.ended = true;
      this.resolveResult(this.getReturn(event));
    }
  }

  end(value: R): void {
    if (this.ended) return;
    this.ended = true;
    this.resolveResult(value);
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Wait for the stream to end and get the final return value */
  wait(): Promise<R> {
    return this.resultPromise;
  }

  /** Subscribe and wait for end */
  async collect(): Promise<R> {
    return this.wait();
  }
}