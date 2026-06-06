import OpenAI from 'openai';
import { Tool, ToolResult, ResultStatus } from './base.js';
import { Hook } from '../hooks/hook.js';
import { HookBuilderBase, HasHooks } from '../hooks/hook-builder.js';

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

/** Tool registry that stores tool instances and exposes them to the service. */
export interface ToolSuiteInterface extends HasHooks<ToolHookBuilder> {
    /** Register a tool so it can be called by the model. Throws on duplicate names. */
    add(tool: Tool): void;
    /** Access the hook builder for tool lifecycle events. */
    hook(): ToolHookBuilder;
}

abstract class BaseToolHook extends Hook {
    protected options: ToolHookOptions;
    private _off: () => void;

    constructor(options: ToolHookOptions, suite: ToolSuite, off: () => void) {
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

    private _onEvent = (name: string, args: Record<string, unknown>): void => {
        if (this.isDisposed()) return;
        if (this._matches(name)) {
            this.safeInvoke(() => this._handler(name, args));
        }
    };

    constructor(
        options: ToolHookOptions,
        suite: ToolSuite,
        handler: (name: string, args: Record<string, unknown>) => void | Promise<void>
    ) {
        super(options, suite, () => suite.off(ToolEvent.Before, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.Before, this._onEvent);
    }
}

class AfterHook extends BaseToolHook {
    private _handler: (result: ToolResult) => void | Promise<void>;

    private _onEvent = (result: ToolResult): void => {
        if (this.isDisposed()) return;
        if (this._matches(result.tool)) {
            this.safeInvoke(() => this._handler(result));
        }
    };

    constructor(
        options: ToolHookOptions,
        suite: ToolSuite,
        handler: (result: ToolResult) => void | Promise<void>
    ) {
        super(options, suite, () => suite.off(ToolEvent.After, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.After, this._onEvent);
    }
}

class ErrorHook extends BaseToolHook {
    private _handler: (name: string, error: Error) => void | Promise<void>;

    private _onEvent = (name: string, error: Error): void => {
        if (this.isDisposed()) return;
        if (this._matches(name)) {
            this.safeInvoke(() => this._handler(name, error));
        }
    };

    constructor(
        options: ToolHookOptions,
        suite: ToolSuite,
        handler: (name: string, error: Error) => void | Promise<void>
    ) {
        super(options, suite, () => suite.off(ToolEvent.Error, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.Error, this._onEvent);
    }
}

export class ToolSuite {
    private tools: Record<string, Tool> = {};
    private listeners = new Map<ToolEvent, Set<(...args: unknown[]) => void>>();
    on<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
    }

    off<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void {
        this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
    }

    private emit<E extends ToolEvent>(event: E, ...args: ToolEventMap[E]): void {
        this.listeners.get(event)?.forEach((handler) => handler(...args));
    }

    add(tool: Tool): void {
        if (this.tools[tool.name]) {
            throw new Error("A tool with the name '" + tool.name + "' is already registered.");
        }
        this.tools[tool.name] = tool;
    }

    getTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return Object.values(this.tools).map((tool) => tool.toOpenAI());
    }

    // Public hook entry
    hook(): ToolHookBuilder {
        return new ToolHookBuilder(this);
    }

    async executeTool(
        name: string,
        args: string
    ): Promise<{ result: string; status: ResultStatus }> {
        const tool = this.tools[name];
        if (!tool) {
            throw new Error("No tool registered with name '" + name + "'");
        }
        const parsedArgs = JSON.parse(args);

        this.emit(ToolEvent.Before, name, parsedArgs);

        const toolResult = await tool.execute(parsedArgs);

        if (toolResult.status === ResultStatus.Error) {
            const error =
                toolResult.error instanceof Error
                    ? toolResult.error
                    : new Error(String(toolResult.error ?? toolResult.result));
            this.emit(ToolEvent.Error, name, error);
        } else {
            this.emit(ToolEvent.After, toolResult);
        }

        return { result: toolResult.result, status: toolResult.status };
    }
}

// --- Public hook builder ---

export class ToolHookBuilder {
    private _filter: string[] | undefined;

    constructor(private _suite: ToolSuite) {}

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
        private _suite: ToolSuite,
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
