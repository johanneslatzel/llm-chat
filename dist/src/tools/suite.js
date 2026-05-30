import { Hook } from '../hooks/hook.js';
export var ToolEvent;
(function (ToolEvent) {
    ToolEvent["Before"] = "before";
    ToolEvent["After"] = "after";
    ToolEvent["Error"] = "error";
})(ToolEvent || (ToolEvent = {}));
class BaseToolHook extends Hook {
    options;
    _off;
    constructor(options, suite, off) {
        super();
        this.options = options;
        this._off = off;
    }
    _matches(name) {
        if (!this.options.tools || this.options.tools.length === 0)
            return true;
        return this.options.tools.includes(name);
    }
    onDispose() {
        this._off();
    }
}
class BeforeHook extends BaseToolHook {
    _handler;
    _onEvent = (name, args) => {
        if (this.isDisposed())
            return;
        if (this._matches(name)) {
            this.safeInvoke(() => this._handler(name, args));
        }
    };
    constructor(options, suite, handler) {
        super(options, suite, () => suite.off(ToolEvent.Before, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.Before, this._onEvent);
    }
}
class AfterHook extends BaseToolHook {
    _handler;
    _onEvent = (result) => {
        if (this.isDisposed())
            return;
        if (this._matches(result.tool)) {
            this.safeInvoke(() => this._handler(result));
        }
    };
    constructor(options, suite, handler) {
        super(options, suite, () => suite.off(ToolEvent.After, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.After, this._onEvent);
    }
}
class ErrorHook extends BaseToolHook {
    _handler;
    _onEvent = (name, error) => {
        if (this.isDisposed())
            return;
        if (this._matches(name)) {
            this.safeInvoke(() => this._handler(name, error));
        }
    };
    constructor(options, suite, handler) {
        super(options, suite, () => suite.off(ToolEvent.Error, this._onEvent));
        this._handler = handler;
        suite.on(ToolEvent.Error, this._onEvent);
    }
}
export class ToolSuite {
    tools = {};
    listeners = new Map();
    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);
    }
    off(event, handler) {
        this.listeners.get(event)?.delete(handler);
    }
    emit(event, ...args) {
        this.listeners.get(event)?.forEach((handler) => handler(...args));
    }
    add(tool) {
        if (this.tools[tool.name]) {
            throw new Error("A tool with the name '" + tool.name + "' is already registered.");
        }
        this.tools[tool.name] = tool;
    }
    getTools() {
        return Object.values(this.tools).map((tool) => tool.toOpenAI());
    }
    before(options, handler) {
        return new BeforeHook(options, this, handler);
    }
    after(options, handler) {
        return new AfterHook(options, this, handler);
    }
    error(options, handler) {
        return new ErrorHook(options, this, handler);
    }
    async executeTool(name, args) {
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
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            this.emit(ToolEvent.Error, name, error);
            throw error;
        }
    }
}
//# sourceMappingURL=suite.js.map