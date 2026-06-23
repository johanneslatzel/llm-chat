import OpenAI from 'openai';
import { Tool } from './tool.js';
import { ResultStatus, ToolResult } from './result.js';
import { ToolPackage } from './package.js';
import { ToolEvent, ToolEventMap, ToolEventTarget, ToolHookBuilder } from './hook.js';
export { ToolEvent };
import { HasHooks } from '../hooks/hook-builder.js';
import { Prompt, PromptContainer } from '../chat/system-prompt.js';

/** Tool registry that stores tool instances and exposes them to the service. */
export interface ToolSuiteInterface extends HasHooks<ToolHookBuilder> {
    /** Register a tool or tool package. Throws on duplicate names. */
    add(item: Tool | ToolPackage): void;
    /** Access the hook builder for tool lifecycle events. */
    hook(): ToolHookBuilder;
    /** Remove all registered tools and packages.
     *  Also clears tool event listeners unless `retainHooks` is `true`. */
    clear(retainHooks?: boolean): void;
    /** Rebuild tutorial entries from all registered packages. */
    rebuildTutorials(): void;
    /** Look up a tool by name. Returns `undefined` if not found. */
    get(name: string): Tool | undefined;
}

export class ToolSuite implements ToolEventTarget {
    #tools: Record<string, Tool> = {};
    #packages: ToolPackage[] = [];
    #tutorialContainer: PromptContainer | null = null;
    private listeners = new Map<ToolEvent, Set<(...args: unknown[]) => void>>();

    setTutorialContainer(container: PromptContainer): void {
        this.#tutorialContainer = container;
    }

    on<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(handler as (...args: unknown[]) => void);
    }

    off<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void {
        this.listeners.get(event)?.delete(handler as (...args: unknown[]) => void);
    }

    private async emit<E extends ToolEvent>(event: E, ...args: ToolEventMap[E]): Promise<void> {
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) await handler(...args);
        }
    }

    add(item: Tool | ToolPackage): void {
        if ('tools' in item) {
            this.#packages.push(item);

            const tutorialContent = item.tutorial();
            if (tutorialContent !== null && this.#tutorialContainer) {
                const pkgContainer = new PromptContainer(`Tool Package ${item.constructor.name}`);
                pkgContainer.add(
                    new Prompt(
                        'Applicability',
                        item
                            .tools()
                            .map((t) => t.name)
                            .join(', ')
                    )
                );
                pkgContainer.add(new Prompt('Tutorial', tutorialContent));
                this.#tutorialContainer.add(pkgContainer);
            }

            for (const tool of item.tools()) {
                this.add(tool);
            }
        } else {
            if (this.#tools[item.name]) {
                throw new Error("A tool with the name '" + item.name + "' is already registered.");
            }
            this.#tools[item.name] = item;
        }
    }

    getTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return Object.values(this.#tools).map((tool) => tool.toOpenAI());
    }

    /** Remove all registered tools and packages. Does NOT affect the tutorial
     *  container reference. When `retainHooks` is `true`, tool event
     *  listeners are preserved. */
    clear(retainHooks?: boolean): void {
        this.#tools = {};
        this.#packages = [];
        if (!retainHooks) this.listeners.clear();
    }

    /** Rebuild tutorial entries inside the current `#tutorialContainer`
     *  from all registered packages. Safe to call after {@link clear}
     *  only if packages have been re-added first. */
    rebuildTutorials(): void {
        if (!this.#tutorialContainer) return;
        this.#tutorialContainer.clear();
        for (const pkg of this.#packages) {
            const content = pkg.tutorial();
            if (content !== null) {
                const pkgContainer = new PromptContainer(`Tool Package ${pkg.constructor.name}`);
                pkgContainer.add(
                    new Prompt(
                        'Applicability',
                        pkg
                            .tools()
                            .map((t) => t.name)
                            .join(', ')
                    )
                );
                pkgContainer.add(new Prompt('Tutorial', content));
                this.#tutorialContainer.add(pkgContainer);
            }
        }
    }

    /** Look up a tool by name. Returns `undefined` if not found. */
    get(name: string): Tool | undefined {
        return this.#tools[name];
    }

    // Public hook entry
    hook(): ToolHookBuilder {
        return new ToolHookBuilder(this);
    }

    async executeTool(name: string, args: string, silent?: boolean): Promise<ToolResult[]> {
        const tool = this.#tools[name];
        if (!tool) {
            const message = "No tool registered with name '" + name + "'";
            if (silent !== true) await this.emit(ToolEvent.Error, name, new Error(message));
            return [
                {
                    result: 'Error: ' + message,
                    status: ResultStatus.Error,
                    tool: name,
                    error: new Error(message)
                }
            ];
        }
        const parsedArgs = JSON.parse(args);

        if (silent !== true) await this.emit(ToolEvent.Before, name, parsedArgs);

        const toolResults = await tool.execute(parsedArgs);

        for (const toolResult of toolResults) {
            if (toolResult.status === ResultStatus.Error) {
                const error =
                    toolResult.error instanceof Error
                        ? toolResult.error
                        : new Error(String(toolResult.error ?? toolResult.result));
                if (silent !== true) await this.emit(ToolEvent.Error, name, error);
            } else {
                if (silent !== true) await this.emit(ToolEvent.After, toolResult);
            }
        }

        return toolResults;
    }
}
