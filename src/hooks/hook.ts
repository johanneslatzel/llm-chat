/** Base class for all hooks. Call {@link dispose} to unsubscribe. */
export abstract class Hook {
    private _disposed = false;

    /** Unsubscribe this hook. Safe to call multiple times. */
    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this.onDispose();
    }

    /** Whether this hook has been disposed. */
    protected isDisposed(): boolean {
        return this._disposed;
    }

    /** Override to clean up subscriptions. Called once by {@link dispose}. */
    protected abstract onDispose(): void;

    /** Invoke a callback synchronously, catching and logging any errors.
     *  Async callbacks are fire-and-forget — the returned Promise is discarded.
     *  Use {@link asyncSafeInvoke} when the caller needs to await the callback. */
    protected safeInvoke(fn: () => void): void {
        try {
            fn();
        } catch (err) {
            console.error('Hook callback error:', err);
        }
    }

    /** Invoke a callback and await its result if it returns a Promise.
     *  Catches and logs errors from sync throws or async rejections.
     *  Use when the caller needs to await the callback before continuing. */
    protected async asyncSafeInvoke(fn: () => void | Promise<void>): Promise<void> {
        try {
            const result = fn();
            if (result instanceof Promise) await result;
        } catch (err) {
            console.error('Hook callback error:', err);
        }
    }
}
