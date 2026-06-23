import { Hook } from '../hooks/hook.js';
import { HookBuilderBase } from '../hooks/hook-builder.js';
import type { ToolResult } from './result.js';

export enum ToolEvent {
    Before = 'before',
    After = 'after',
    Error = 'error'
}

export type ToolEventMap = {
    [ToolEvent.Before]: [name: string, args: Record<string, unknown>];
    [ToolEvent.After]: [result: ToolResult];
    [ToolEvent.Error]: [name: string, error: Error];
};

export type ToolHookOptions = {
    tools?: string[];
};

/** Minimal interface that hook classes need from ToolSuite. Avoids circular imports. */
export interface ToolEventTarget {
    on<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void;
    off<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void;
}

// --- Internal hook implementations ---

abstract class BaseToolHook extends Hook {
    protected options: ToolHookOptions;
    private _off: () => void;

    constructor(options: ToolHookOptions, suite: ToolEventTarget, off: () => void) {
        super();
        this.options = options;
        this._off = off;
    }

    protected _matches(name: string): boolean {
        if (!this.options.tools || this.options.tools.length === 0) return true;
        return this.options.tools.includes(name);
    }

    protected onDispose(): void {
        this._off();
    }
}

class BeforeHook extends BaseToolHook {
    private _handler: (name: string, args: Record<string, unknown>) => void | Promise<void>;

    private _onEvent = async (name: string, args: Record<string, unknown>): Promise<void> => {
        if (this.isDisposed()) return;
        if (this._matches(name)) {
            await this.asyncSafeInvoke(() => this._handler(name, args));
        }
    };

    constructor(
        options: ToolHookOptions,
        suite: ToolEventTarget,
        handler: (name: string, args: Record<string, unknown>) => void | Promise<void>
    ) {
        super(options, suite, () => suite.off(ToolEvent.Before, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.Before, this._onEvent);
    }
}

class AfterHook extends BaseToolHook {
    private _handler: (result: ToolResult) => void | Promise<void>;

    private _onEvent = async (result: ToolResult): Promise<void> => {
        if (this.isDisposed()) return;
        if (this._matches(result.tool)) {
            await this.asyncSafeInvoke(() => this._handler(result));
        }
    };

    constructor(
        options: ToolHookOptions,
        suite: ToolEventTarget,
        handler: (result: ToolResult) => void | Promise<void>
    ) {
        super(options, suite, () => suite.off(ToolEvent.After, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.After, this._onEvent);
    }
}

class ErrorHook extends BaseToolHook {
    private _handler: (name: string, error: Error) => void | Promise<void>;

    private _onEvent = async (name: string, error: Error): Promise<void> => {
        if (this.isDisposed()) return;
        if (this._matches(name)) {
            await this.asyncSafeInvoke(() => this._handler(name, error));
        }
    };

    constructor(
        options: ToolHookOptions,
        suite: ToolEventTarget,
        handler: (name: string, error: Error) => void | Promise<void>
    ) {
        super(options, suite, () => suite.off(ToolEvent.Error, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.Error, this._onEvent);
    }
}

// --- Public hook builder ---

export class ToolHookBuilder {
    private _filter: string[] | undefined;

    constructor(private _suite: ToolEventTarget) {}

    filter(...names: string[]): this {
        this._filter = names;
        return this;
    }

    before(): ToolHookFilterBuilder<(name: string, args: Record<string, unknown>) => void> {
        return new ToolHookFilterBuilder(this._suite, ToolEvent.Before, this._filter);
    }

    after(): ToolHookFilterBuilder<(result: ToolResult) => void> {
        return new ToolHookFilterBuilder(this._suite, ToolEvent.After, this._filter);
    }

    error(): ToolHookFilterBuilder<(name: string, error: Error) => void> {
        return new ToolHookFilterBuilder(this._suite, ToolEvent.Error, this._filter);
    }
}

type ToolHookHandler = (...args: any[]) => void | Promise<void>;

class ToolHookFilterBuilder<TCallback extends ToolHookHandler> extends HookBuilderBase<TCallback> {
    constructor(
        private _suite: ToolEventTarget,
        private _event: ToolEvent,
        private _filter: string[] | undefined
    ) {
        super();
    }

    do(handler: TCallback): Hook {
        const options: ToolHookOptions = this._filter ? { tools: this._filter } : {};
        const { _suite: suite, _event: event } = this;
        switch (event) {
            case ToolEvent.Before:
                return new BeforeHook(
                    options,
                    suite,
                    handler as (name: string, args: Record<string, unknown>) => void | Promise<void>
                );
            case ToolEvent.After:
                return new AfterHook(
                    options,
                    suite,
                    handler as (result: ToolResult) => void | Promise<void>
                );
            case ToolEvent.Error:
                return new ErrorHook(
                    options,
                    suite,
                    handler as (name: string, error: Error) => void | Promise<void>
                );
        }
    }
}
