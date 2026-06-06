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

    /** Invoke a callback, catching and logging any errors. */
    protected safeInvoke(fn: () => void): void {
        try {
            fn();
        } catch (err) {
            console.error('Hook callback error:', err);
        }
    }
}
