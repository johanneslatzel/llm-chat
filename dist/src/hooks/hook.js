export class Hook {
    _disposed = false;
    dispose() {
        if (this._disposed)
            return;
        this._disposed = true;
        this.onDispose();
    }
    isDisposed() {
        return this._disposed;
    }
    safeInvoke(fn) {
        try {
            fn();
        }
        catch (err) {
            console.error('Hook callback error:', err);
        }
    }
}
//# sourceMappingURL=hook.js.map