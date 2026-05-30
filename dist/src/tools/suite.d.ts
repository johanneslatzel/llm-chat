import OpenAI from 'openai';
import { Tool, ToolResult } from './base.js';
import { Hook } from '../hooks/hook.js';
export declare enum ToolEvent {
    Before = "before",
    After = "after",
    Error = "error"
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
    before(options: ToolHookOptions, handler: (name: string, args: Record<string, unknown>) => void | Promise<void>): Hook;
    after(options: ToolHookOptions, handler: (result: ToolResult) => void | Promise<void>): Hook;
    error(options: ToolHookOptions, handler: (name: string, error: Error) => void | Promise<void>): Hook;
}
export declare class ToolSuite {
    private tools;
    private listeners;
    on<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void;
    off<E extends ToolEvent>(event: E, handler: (...args: ToolEventMap[E]) => void): void;
    private emit;
    add(tool: Tool): void;
    getTools(): OpenAI.Chat.Completions.ChatCompletionTool[];
    before(options: ToolHookOptions, handler: (name: string, args: Record<string, unknown>) => void | Promise<void>): Hook;
    after(options: ToolHookOptions, handler: (result: ToolResult) => void | Promise<void>): Hook;
    error(options: ToolHookOptions, handler: (name: string, error: Error) => void | Promise<void>): Hook;
    executeTool(name: string, args: string): Promise<{
        result: string;
        status: string;
    }>;
}
//# sourceMappingURL=suite.d.ts.map