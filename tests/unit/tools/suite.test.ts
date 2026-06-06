import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolSuite, ToolEvent } from '../../../src/tools/suite.js';
import { AlphaTool, BetaTool, FailingTool, ThrowsNonErrorTool } from '../../helper/tool-mocks.js';

describe('ToolSuite', () => {
    let suite: ToolSuite;

    beforeEach(() => {
        suite = new ToolSuite();
    });

    it('registers a tool', () => {
        const tool = new AlphaTool();
        suite.add(tool);
        const tools = suite.getTools();
        expect(tools).toHaveLength(1);
        expect(tools[0]!.function.name).toBe('alpha');
    });

    it('throws when registering a duplicate tool name', () => {
        suite.add(new AlphaTool());
        expect(() => suite.add(new AlphaTool())).toThrow(
            "A tool with the name 'alpha' is already registered."
        );
    });

    it('getTools returns all registered tools as OpenAI format', () => {
        suite.add(new AlphaTool());
        suite.add(new BetaTool());
        const tools = suite.getTools();
        expect(tools).toHaveLength(2);
        const names = tools.map((t) => t.function.name).sort();
        expect(names).toEqual(['alpha', 'beta']);
    });

    it('executeTool parses JSON args and calls the tool', async () => {
        suite.add(new AlphaTool());
        const result = await suite.executeTool('alpha', '{"x": "hello"}');
        expect(result.result).toBe('Alpha: hello');
        expect(result.status).toBe('success');
    });

    it('executeTool throws for unknown tool name', async () => {
        await expect(suite.executeTool('unknown', '{}')).rejects.toThrow(
            "No tool registered with name 'unknown'"
        );
    });

    it('executeTool throws for invalid JSON args', async () => {
        suite.add(new AlphaTool());
        await expect(suite.executeTool('alpha', '{invalid json}')).rejects.toThrow();
    });

    it('getTools returns empty array when no tools registered', () => {
        expect(suite.getTools()).toEqual([]);
    });

    describe('events - off() edge cases', () => {
        it('calling off() for non-existent event does not throw', () => {
            const handler = vi.fn();
            expect(() => suite.off(ToolEvent.Before, handler)).not.toThrow();
        });

        it('adding two listeners for the same event works', async () => {
            suite.add(new AlphaTool());
            const handler1 = vi.fn();
            const handler2 = vi.fn();
            suite.on(ToolEvent.Before, handler1);
            suite.on(ToolEvent.Before, handler2);
            await suite.executeTool('alpha', '{"x": "test"}');
            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
        });
    });

    describe('hooks', () => {
        it('fires before handler before tool execution', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.hook().before().do(handler);
            await suite.executeTool('alpha', '{"x": "test"}');
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith('alpha', { x: 'test' });
        });

        it('fires after handler after successful tool execution', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.hook().after().do(handler);
            await suite.executeTool('alpha', '{"x": "hello"}');
            expect(handler).toHaveBeenCalledTimes(1);
            const result = handler.mock.calls[0]![0];
            expect(result.tool).toBe('alpha');
            expect(result.result).toBe('Alpha: hello');
            expect(result.status).toBe('success');
        });

        it('fires error handler on tool failure', async () => {
            suite.add(new FailingTool());
            const handler = vi.fn();
            suite.hook().error().do(handler);
            const result = await suite.executeTool('failing', '{}');
            expect(result).toEqual({ result: 'Error: Intentional failure', status: 'error' });
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith('failing', expect.any(Error));
            expect(handler.mock.calls[0]![1].message).toBe('Intentional failure');
        });

        it('filters by tool name in before handler', async () => {
            suite.add(new AlphaTool());
            suite.add(new BetaTool());
            const handler = vi.fn();
            suite.hook().filter('beta').before().do(handler);
            await suite.executeTool('alpha', '{"x": "ignored"}');
            expect(handler).not.toHaveBeenCalled();
            await suite.executeTool('beta', '{}');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('filters by tool name in after handler', async () => {
            suite.add(new AlphaTool());
            suite.add(new BetaTool());
            const handler = vi.fn();
            suite.hook().filter('beta').after().do(handler);
            await suite.executeTool('alpha', '{"x": "ignored"}');
            expect(handler).not.toHaveBeenCalled();
            await suite.executeTool('beta', '{}');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('filters by tool name in error handler', async () => {
            suite.add(new FailingTool());
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.hook().filter('failing').error().do(handler);
            await suite.executeTool('alpha', '{"x": "ok"}');
            expect(handler).not.toHaveBeenCalled();
            const result = await suite.executeTool('failing', '{}');
            expect(result.status).toBe('error');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('does not fire before handler when no tool executes', () => {
            const handler = vi.fn();
            suite.hook().before().do(handler);
            expect(handler).not.toHaveBeenCalled();
        });

        it('supports disposal via dispose()', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            const hook = suite.hook().before().do(handler);
            hook.dispose();
            await suite.executeTool('alpha', '{"x": "gone"}');
            expect(handler).not.toHaveBeenCalled();
        });

        it('does not fire after handler after disposal', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            const hook = suite.hook().after().do(handler);
            hook.dispose();
            await suite.executeTool('alpha', '{"x": "gone"}');
            expect(handler).not.toHaveBeenCalled();
        });

        it('wraps non-Error throws in Error on handler', async () => {
            suite.add(new ThrowsNonErrorTool());
            const handler = vi.fn();
            suite.hook().error().do(handler);
            const result = await suite.executeTool('throws_non_error', '{}');
            expect(result).toEqual({ result: 'Error: string error value', status: 'error' });
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler.mock.calls[0]![1]).toBeInstanceOf(Error);
            expect(handler.mock.calls[0]![1].message).toBe('string error value');
        });

        it('does not fire error handler after disposal', async () => {
            suite.add(new FailingTool());
            const handler = vi.fn();
            const hook = suite.hook().error().do(handler);
            hook.dispose();
            const result = await suite.executeTool('failing', '{}');
            expect(result.status).toBe('error');
            expect(handler).not.toHaveBeenCalled();
        });

        it('error hook filter does not fire for non-matching tool name', async () => {
            suite.add(new FailingTool());
            const handler = vi.fn();
            suite.hook().filter('other_tool').error().do(handler);
            const result = await suite.executeTool('failing', '{}');
            expect(result.status).toBe('error');
            expect(handler).not.toHaveBeenCalled();
        });

        it('no filter matches all tools', async () => {
            suite.add(new AlphaTool());
            suite.add(new BetaTool());
            const handler = vi.fn();
            suite.hook().before().do(handler);
            await suite.executeTool('alpha', '{"x": "a"}');
            await suite.executeTool('beta', '{}');
            expect(handler).toHaveBeenCalledTimes(2);
        });

        it('filter() with multiple tool names', async () => {
            suite.add(new AlphaTool());
            suite.add(new BetaTool());
            const handler = vi.fn();
            suite.hook().filter('alpha', 'beta').before().do(handler);
            await suite.executeTool('alpha', '{"x": "a"}');
            await suite.executeTool('beta', '{}');
            expect(handler).toHaveBeenCalledTimes(2);
        });
    });

    describe('events', () => {
        it('emits BeforeExecute before tool execution', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.on(ToolEvent.Before, handler);
            await suite.executeTool('alpha', '{"x": "test"}');
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith('alpha', { x: 'test' });
        });

        it('emits AfterExecute after successful tool execution', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.on(ToolEvent.After, handler);
            await suite.executeTool('alpha', '{"x": "hello"}');
            expect(handler).toHaveBeenCalledTimes(1);
            const result = handler.mock.calls[0]![0];
            expect(result.tool).toBe('alpha');
            expect(result.result).toBe('Alpha: hello');
            expect(result.status).toBe('success');
        });

        it('emits Error when tool execution fails', async () => {
            suite.add(new FailingTool());
            const handler = vi.fn();
            suite.on(ToolEvent.Error, handler);
            const result = await suite.executeTool('failing', '{}');
            expect(result).toEqual({ result: 'Error: Intentional failure', status: 'error' });
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith('failing', expect.any(Error));
            expect(handler.mock.calls[0]![1].message).toBe('Intentional failure');
        });

        it('BeforeExecute fires before AfterExecute on success', async () => {
            suite.add(new AlphaTool());
            const order: string[] = [];
            suite.on(ToolEvent.Before, () => { order.push('before'); });
            suite.on(ToolEvent.After, () => { order.push('after'); });
            await suite.executeTool('alpha', '{"x": "ordered"}');
            expect(order).toEqual(['before', 'after']);
        });

        it('can remove an event listener with off()', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.on(ToolEvent.Before, handler);
            suite.off(ToolEvent.Before, handler);
            await suite.executeTool('alpha', '{"x": "silent"}');
            expect(handler).not.toHaveBeenCalled();
        });
    });
});
