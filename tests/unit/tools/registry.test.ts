import { describe, it, expect, beforeEach } from 'vitest';
import { ToolSuite } from '../../../src/tools/suite.js';
import { AlphaTool, BetaTool } from '../../helper/tool-mocks.js';

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
        const result = await registry.executeTool('alpha', '{"x": "hello"}');
        expect(result.result).toBe('Alpha: hello');
        expect(result.status).toBe('success');
    });

    it('executeTool throws for unknown tool name', async () => {
        await expect(registry.executeTool('unknown', '{}')).rejects.toThrow(
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
