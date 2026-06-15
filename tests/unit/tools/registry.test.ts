import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolSuite, ToolEvent } from '../../../src/tools/suite.js';
import { AlphaTool, BetaTool } from '../../helper/tool-mocks.js';
import { ResultStatus } from '../../../src/index.js';

describe('ToolSuite (aliased as ToolRegistry for backward compat)', () => {
    let registry: ToolSuite;

    beforeEach(() => {
        registry = new ToolSuite();
    });

    it('registers a tool', () => {
        const tool = new AlphaTool();
        registry.add(tool);
        const tools = registry.getTools();
        expect(tools).toHaveLength(1);
        expect(tools[0]!.function.name).toBe('alpha');
    });

    it('throws when registering a duplicate tool name', () => {
        registry.add(new AlphaTool());
        expect(() => registry.add(new AlphaTool())).toThrow(
            "A tool with the name 'alpha' is already registered."
        );
    });

    it('getTools returns all registered tools as OpenAI format', () => {
        registry.add(new AlphaTool());
        registry.add(new BetaTool());
        const tools = registry.getTools();
        expect(tools).toHaveLength(2);
        const names = tools.map((t) => t.function.name).sort();
        expect(names).toEqual(['alpha', 'beta']);
    });

    it('executeTool parses JSON args and calls the tool', async () => {
        registry.add(new AlphaTool());
        const results = await registry.executeTool('alpha', '{"x": "hello"}');
        expect(results[0]!.result).toBe('Alpha: hello');
        expect(results[0]!.status).toBe('success');
    });

    it('executeTool returns error for unknown tool name', async () => {
        const results = await registry.executeTool('unknown', '{}');
        expect(results[0]!).toEqual({
            result: "Error: No tool registered with name 'unknown'",
            status: ResultStatus.Error
        });
    });

    it('executeTool emits Error event for unknown tool name', async () => {
        const handler = vi.fn();
        registry.on(ToolEvent.Error, handler);
        await registry.executeTool('unknown', '{}');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('unknown', expect.any(Error));
        expect(handler.mock.calls[0]![1].message).toBe(
            "No tool registered with name 'unknown'"
        );
    });

    it('executeTool throws for invalid JSON args', async () => {
        registry.add(new AlphaTool());
        await expect(registry.executeTool('alpha', '{invalid json}')).rejects.toThrow();
    });

    it('getTools returns empty array when no tools registered', () => {
        expect(registry.getTools()).toEqual([]);
    });
});
