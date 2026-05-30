import OpenAI from 'openai';
import { Tool, ToolResult } from './base.js';
import { Hook } from '../hooks/hook.js';

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

export interface ToolSuiteInterface {
    add(tool: Tool): void;
    before(
        options: ToolHookOptions,
        handler: (name: string, args: Record<string, unknown>) => void | Promise<void>
    ): Hook;
    after(options: ToolHookOptions, handler: (result: ToolResult) => void | Promise<void>): Hook;
    error(
        options: ToolHookOptions,
        handler: (name: string, error: Error) => void | Promise<void>
    ): Hook;
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

    before(
        options: ToolHookOptions,
        handler: (name: string, args: Record<string, unknown>) => void | Promise<void>
    ): Hook {
        return new BeforeHook(options, this, handler);
    }

    after(options: ToolHookOptions, handler: (result: ToolResult) => void | Promise<void>): Hook {
        return new AfterHook(options, this, handler);
    }

    error(
        options: ToolHookOptions,
        handler: (name: string, error: Error) => void | Promise<void>
    ): Hook {
        return new ErrorHook(options, this, handler);
    }

    async executeTool(name: string, args: string): Promise<{ result: string; status: string }> {
        const tool = this.tools[name];
        if (!tool) {
            throw new Error("No tool registered with name '" + name + "'");
        }
        const parsedArgs = JSON.parse(args);

        this.emit(ToolEvent.Before, name, parsedArgs);

        try {
            const toolResult = await tool.execute(parsedArgs);
            const result = { result: toolResult.result, status: toolResult.status };
            this.emit(ToolEvent.After, toolResult);
            return result;
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.emit(ToolEvent.Error, name, error);
            throw error;
        }
    }
}
