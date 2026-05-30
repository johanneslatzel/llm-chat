export declare abstract class Hook {
    private _disposed;
    dispose(): void;
    protected isDisposed(): boolean;
    protected abstract onDispose(): void;
    protected safeInvoke(fn: () => void): void;
}
//# sourceMappingURL=hook.d.ts.map