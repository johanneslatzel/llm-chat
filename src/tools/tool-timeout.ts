import { Tool } from './tool.js';
import { ToolParameters } from './parameter.js';
import { ResultStatus, type PartialToolResult, type ToolResult } from './result.js';

/** Reason a {@link TimedTool} reports that its wait ended early. */
export enum TimedToolNotificationKind {
    Timeout = 'timeout',
    Cancelled = 'cancelled'
}

/**
 * Flatten a list of tool results into a linked `next` chain.
 *
 * @param results - Results to chain, in execution order.
 * @returns A result whose `next` field links the remaining results.
 */
function toChain(results: readonly ToolResult[]): PartialToolResult {
    const [first, ...rest] = results;
    if (first === undefined) {
        return { result: '', status: ResultStatus.Success };
    }
    return {
        result: first.result,
        status: first.status,
        ...(rest.length > 0 ? { next: toChain(rest) } : {})
    };
}

/**
 * Build an error result for a timeout or cancellation.
 *
 * @param message - Human-readable reason.
 * @returns An error result whose text is prefixed with `Error: `.
 */
function errorChain(message: string): PartialToolResult {
    return {
        result: 'Error: ' + message,
        status: ResultStatus.Error
    };
}

/**
 * Wraps a tool so a single execution is bounded by a timeout and cancelled
 * when the owning run is aborted. A timed-out or cancelled call resolves with
 * an error result instead of hanging the send loop.
 *
 * The wrapper only bounds the wait. It cannot force the inner tool to stop:
 * shell, file or network work may continue after a timeout or abort.
 *
 * Tool-wrapper contract: a wrapper extends `Tool`, delegates `toOpenAI()` to
 * the wrapped definition and performs its work in `onExecute`, resolving tool
 * failures as a `PartialToolResult` instead of throwing.
 */
export class TimedTool extends Tool {
    private readonly _inner: Tool;
    private readonly _timeoutMs: number;
    private readonly _signal: () => AbortSignal | undefined;
    private readonly _notify: (kind: TimedToolNotificationKind, message: string) => void;

    constructor(
        inner: Tool,
        timeoutMs: number,
        notify: (kind: TimedToolNotificationKind, message: string) => void = () => undefined,
        signal: () => AbortSignal | undefined = () => undefined
    ) {
        super(inner.name, inner.description, new ToolParameters({}));
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            throw new RangeError(
                `TimedTool '${inner.name}' requires timeoutMs > 0, received ${timeoutMs}`
            );
        }
        this._inner = inner;
        this._timeoutMs = timeoutMs;
        this._notify = notify;
        this._signal = signal;
    }

    /** Delegate the provider definition to the wrapped tool. */
    override toOpenAI(): ReturnType<Tool['toOpenAI']> {
        return this._inner.toOpenAI();
    }

    /** Execute the wrapped tool with a timeout and abort signal. */
    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        const signal = this._signal();
        if (signal?.aborted === true) {
            return this._cancelledResult();
        }

        return this._executeWithTimeout(args, signal);
    }

    /**
     * Race the wrapped execution against the timeout and abort signal.
     *
     * @param args - Arguments forwarded to the wrapped tool.
     * @param signal - Abort signal for the owning run, if any.
     * @returns The first result, with later results ignored.
     */
    private _executeWithTimeout(
        args: Record<string, unknown>,
        signal: AbortSignal | undefined
    ): Promise<PartialToolResult> {
        return new Promise<PartialToolResult>((resolve) => {
            let settled = false;
            let timer: ReturnType<typeof setTimeout> | undefined;

            const settle = (result: PartialToolResult): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                resolve(result);
            };

            const onAbort = (): void => settle(this._cancelledResult());

            timer = setTimeout(() => settle(this._timeoutResult()), this._timeoutMs);
            timer.unref();
            signal?.addEventListener('abort', onAbort, { once: true });

            void this._inner.execute(args).then(
                (results) => settle(toChain(results)),
                (error: unknown) => settle(this._failureResult(error))
            );
        });
    }

    /** Build and report the timeout result. */
    private _timeoutResult(): PartialToolResult {
        const message = `Tool '${this.name}' timed out after ${this._timeoutMs} ms`;
        this._notifySafely(TimedToolNotificationKind.Timeout, message);
        return errorChain(message);
    }

    /** Build and report the cancellation result. */
    private _cancelledResult(): PartialToolResult {
        const message = `Tool '${this.name}' was cancelled`;
        this._notifySafely(TimedToolNotificationKind.Cancelled, message);
        return errorChain(message);
    }

    /**
     * Report a notification without letting a failing callback escape.
     *
     * The callback is caller-supplied and runs while a result is being
     * settled, so an exception from it must not prevent the result from
     * resolving.
     *
     * @param kind - Why the wait ended.
     * @param message - Human-readable reason.
     */
    private _notifySafely(kind: TimedToolNotificationKind, message: string): void {
        try {
            this._notify(kind, message);
        } catch {
            // Every notification failure is ignored; the result still settles.
        }
    }

    /** Convert an inner rejection into an error result. */
    private _failureResult(error: unknown): PartialToolResult {
        return errorChain(error instanceof Error ? error.message : String(error));
    }
}
