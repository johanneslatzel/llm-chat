import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolSuite, ToolEvent } from '../../../src/tools/suite.js';
import { AlphaTool, BetaTool, FailingTool, ThrowsNonErrorTool } from '../../helper/tool-mocks.js';

describe('ToolSuite hooks', () => {
    let suite: ToolSuite;

    beforeEach(() => {
        suite = new ToolSuite();
    });

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
        const [result] = await suite.executeTool('failing', '{}');
        expect(result).toMatchObject({ result: 'Error: Intentional failure', status: 'error', tool: 'failing' });
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
        const results = await suite.executeTool('failing', '{}');
        expect(results[0]!.status).toBe('error');
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
        const results = await suite.executeTool('throws_non_error', '{}');
        expect(results[0]!).toMatchObject({ result: 'Error: string error value', status: 'error', tool: 'throws_non_error' });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0]![1]).toBeInstanceOf(Error);
        expect(handler.mock.calls[0]![1].message).toBe('string error value');
    });

    it('does not fire error handler after disposal', async () => {
        suite.add(new FailingTool());
        const handler = vi.fn();
        const hook = suite.hook().error().do(handler);
        hook.dispose();
        const results = await suite.executeTool('failing', '{}');
        expect(results[0]!.status).toBe('error');
        expect(handler).not.toHaveBeenCalled();
    });

    it('error hook filter does not fire for non-matching tool name', async () => {
        suite.add(new FailingTool());
        const handler = vi.fn();
        suite.hook().filter('other_tool').error().do(handler);
        const results = await suite.executeTool('failing', '{}');
        expect(results[0]!.status).toBe('error');
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
        const results = await suite.executeTool('failing', '{}');
        expect(results[0]!).toMatchObject({ result: 'Error: Intentional failure', status: 'error', tool: 'failing' });
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

    it('isDisposed guard in BeforeHook _onEvent prevents callback after dispose', () => {
        suite.add(new AlphaTool());
        const handler = vi.fn();
        const hook = suite.hook().before().do(handler);
        const internalOnEvent = (hook as any)._onEvent;
        hook.dispose();
        internalOnEvent('alpha', { x: 'test' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('isDisposed guard in AfterHook _onEvent prevents callback after dispose', async () => {
        suite.add(new AlphaTool());
        const handler = vi.fn();
        const hook = suite.hook().after().do(handler);
        const internalOnEvent = (hook as any)._onEvent;
        hook.dispose();
        internalOnEvent({ tool: 'alpha', result: 'ok', status: 'success' });
        expect(handler).not.toHaveBeenCalled();
    });

    it('isDisposed guard in ErrorHook _onEvent prevents callback after dispose', () => {
        suite.add(new AlphaTool());
        const handler = vi.fn();
        const hook = suite.hook().error().do(handler);
        const internalOnEvent = (hook as any)._onEvent;
        hook.dispose();
        internalOnEvent('alpha', new Error('test'));
        expect(handler).not.toHaveBeenCalled();
    });

    it('does not fire events when silent is true', async () => {
        suite.add(new AlphaTool());
        const beforeHandler = vi.fn();
        const afterHandler = vi.fn();
        suite.hook().before().do(beforeHandler);
        suite.hook().after().do(afterHandler);

        const results = await suite.executeTool('alpha', '{"x": "hello"}', true);

        expect(results[0]!).toMatchObject({ result: 'Alpha: hello', status: 'success', tool: 'alpha' });
        expect(beforeHandler).not.toHaveBeenCalled();
        expect(afterHandler).not.toHaveBeenCalled();
    });

    it('suppresses error event for unknown tool when silent is true', async () => {
        const errorHandler = vi.fn();
        suite.hook().error().do(errorHandler);

        const results = await suite.executeTool('unknown', '{}', true);

        expect(results[0]!).toMatchObject({
            result: "Error: No tool registered with name 'unknown'",
            status: 'error',
            tool: 'unknown'
        });
        expect(errorHandler).not.toHaveBeenCalled();
    });

    it('fires events by default when silent is undefined', async () => {
        suite.add(new AlphaTool());
        const beforeHandler = vi.fn();
        suite.hook().before().do(beforeHandler);

        await suite.executeTool('alpha', '{"x": "test"}');

        expect(beforeHandler).toHaveBeenCalledTimes(1);
    });

    it('fires events when silent is false', async () => {
        suite.add(new AlphaTool());
        const beforeHandler = vi.fn();
        suite.hook().before().do(beforeHandler);

        await suite.executeTool('alpha', '{"x": "test"}', false);

        expect(beforeHandler).toHaveBeenCalledTimes(1);
    });
});
