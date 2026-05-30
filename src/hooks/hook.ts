export abstract class Hook {
    private _disposed = false;

    dispose(): void {
        if (this._disposed) return;
        this._disposed = true;
        this.onDispose();
    }

    protected isDisposed(): boolean {
        return this._disposed;
    }

    protected abstract onDispose(): void;

    protected safeInvoke(fn: () => void): void {
        try {
            fn();
        } catch (err) {
            console.error('Hook callback error:', err);
        }
    }
}
