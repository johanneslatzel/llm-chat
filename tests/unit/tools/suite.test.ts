import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolSuite, ToolEvent } from '../../../src/tools/suite.js';
import { AlphaTool, BetaTool, FailingTool, ThrowsNonErrorTool, AlphaBetaPackage, TutorialPackage } from '../../helper/tool-mocks.js';
import { ResultStatus, Tool, ToolParameters, type PartialToolResult, ToolPackage, PromptContainer, ResultBuilder } from '../../../src/index.js';

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
        const results = await suite.executeTool('alpha', '{"x": "hello"}');
        expect(results[0]!.result).toBe('Alpha: hello');
        expect(results[0]!.status).toBe('success');
    });

    it('executeTool returns error for unknown tool name', async () => {
        const results = await suite.executeTool('unknown', '{}');
        expect(results[0]!).toMatchObject({
            result: "Error: No tool registered with name 'unknown'",
            status: ResultStatus.Error,
            tool: 'unknown'
        });
    });

    it('executeTool emits Error event for unknown tool name', async () => {
        const handler = vi.fn();
        suite.on(ToolEvent.Error, handler);
        await suite.executeTool('unknown', '{}');
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith('unknown', expect.any(Error));
        expect(handler.mock.calls[0]![1].message).toBe(
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

    it('get returns a registered tool by name', () => {
        suite.add(new AlphaTool());
        const tool = suite.get('alpha');
        expect(tool).toBeDefined();
        expect(tool!.name).toBe('alpha');
    });

    it('get returns undefined for unknown name', () => {
        suite.add(new AlphaTool());
        expect(suite.get('nonexistent')).toBeUndefined();
    });

    it('get returns undefined when no tools registered', () => {
        expect(suite.get('anything')).toBeUndefined();
    });

    describe('ToolPackage', () => {
        it('registers all tools from a package', () => {
            suite.add(new AlphaBetaPackage());
            const tools = suite.getTools();
            expect(tools).toHaveLength(2);
            const names = tools.map((t) => t.function.name).sort();
            expect(names).toEqual(['alpha', 'beta']);
        });

        it('throws on duplicate when package tool conflicts with existing tool', () => {
            suite.add(new AlphaTool());
            expect(() => suite.add(new AlphaBetaPackage())).toThrow(
                "A tool with the name 'alpha' is already registered."
            );
        });

        it('tools from a package work with executeTool', async () => {
            suite.add(new AlphaBetaPackage());
            const results = await suite.executeTool('alpha', '{"x": "pkg"}');
            expect(results[0]!.result).toBe('Alpha: pkg');
            expect(results[0]!.status).toBe('success');
        });

        it('tools from a package fire hooks', async () => {
            suite.add(new AlphaBetaPackage());
            const handler = vi.fn();
            suite.hook().filter('beta').before().do(handler);
            await suite.executeTool('beta', '{}');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('supports adding tools after construction via protected add()', () => {
            class DynamicPackage extends ToolPackage {
                constructor() {
                    super();
                    this.add(new AlphaTool());
                    this.add(new BetaTool());
                }
            }
            suite.add(new DynamicPackage());
            const tools = suite.getTools();
            expect(tools).toHaveLength(2);
        });

        it('auto-populates tutorial container when a package with tutorial is added', () => {
            const container = new PromptContainer('');
            suite.setTutorialContainer(container);
            suite.add(new TutorialPackage());
            const output = container.content();
            expect(output).toContain('Tool Package TutorialPackage');
            expect(output).toContain('Applicability');
            expect(output).toContain('alpha, beta');
            expect(output).toContain('Tutorial');
            expect(output).toContain('Use alpha and beta together.');
        });

        it('does not populate tutorial container for packages without tutorial', () => {
            const container = new PromptContainer('');
            suite.setTutorialContainer(container);
            suite.add(new AlphaBetaPackage());
            expect(container.hasContent()).toBe(false);
        });

        it('does not populate tutorial container for single tools', () => {
            const container = new PromptContainer('');
            suite.setTutorialContainer(container);
            suite.add(new AlphaTool());
            expect(container.hasContent()).toBe(false);
        });

        it('does not crash when adding a package with tutorial but no container set', () => {
            expect(() => suite.add(new TutorialPackage())).not.toThrow();
        });
    });

    describe('clear', () => {
        it('removes all registered tools', () => {
            suite.add(new AlphaTool());
            suite.add(new BetaTool());
            suite.clear();
            expect(suite.getTools()).toEqual([]);
        });

        it('removes all registered packages', () => {
            suite.add(new AlphaBetaPackage());
            suite.clear();
            expect(suite.getTools()).toEqual([]);
        });

        it('allows re-adding tools after clear', () => {
            suite.add(new AlphaTool());
            suite.clear();
            suite.add(new AlphaTool());
            expect(suite.getTools()).toHaveLength(1);
        });

        it('clears registered hooks so they no longer fire on tool events', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.hook().before().do(handler);

            await suite.executeTool('alpha', '{}');
            expect(handler).toHaveBeenCalledTimes(1);

            suite.clear();
            suite.add(new AlphaTool());

            await suite.executeTool('alpha', '{}');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('retainHooks keeps hooks active after clear', async () => {
            suite.add(new AlphaTool());
            const handler = vi.fn();
            suite.hook().before().do(handler);

            await suite.executeTool('alpha', '{}');
            expect(handler).toHaveBeenCalledTimes(1);

            suite.clear(true);
            suite.add(new AlphaTool());

            await suite.executeTool('alpha', '{}');
            expect(handler).toHaveBeenCalledTimes(2);
        });
    });

    describe('rebuildTutorials', () => {
        it('re-populates tutorial container from registered packages', () => {
            const container = new PromptContainer('');
            suite.setTutorialContainer(container);
            suite.add(new TutorialPackage());
            container.clear();

            suite.rebuildTutorials();

            const output = container.content();
            expect(output).toContain('Tool Package TutorialPackage');
            expect(output).toContain('Applicability');
            expect(output).toContain('alpha, beta');
            expect(output).toContain('Tutorial');
            expect(output).toContain('Use alpha and beta together.');
        });

        it('does nothing when no tutorial container is set', () => {
            expect(() => suite.rebuildTutorials()).not.toThrow();
        });

        it('does nothing when no packages with tutorials are registered', () => {
            const container = new PromptContainer('');
            suite.setTutorialContainer(container);
            suite.add(new AlphaBetaPackage());
            container.clear();
            suite.rebuildTutorials();
            expect(container.hasContent()).toBe(false);
        });
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
    });

    describe('isDisposed guards', () => {
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
    });

    describe('error without throwing', () => {
        class ReturnsErrorTool extends Tool {
            constructor() {
                super('returns_error', 'Returns error without throwing', new ToolParameters({}));
            }
            protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                return { result: 'handled error', status: ResultStatus.Error };
            }
        }

        it('emits Error event when tool returns error status without throwing', async () => {
            suite.add(new ReturnsErrorTool());
            const handler = vi.fn();
            suite.hook().error().do(handler);
            const results = await suite.executeTool('returns_error', '{}');
            expect(results[0]!).toMatchObject({ result: 'handled error', status: 'error', tool: 'returns_error' });
            expect(handler).toHaveBeenCalledTimes(1);
            expect(handler).toHaveBeenCalledWith('returns_error', expect.any(Error));
            expect(handler.mock.calls[0]![1].message).toBe('handled error');
        });
    });

    describe('multi-result', () => {
        class MultiResultTool extends Tool {
            constructor() {
                super('multi', 'Returns multiple results', new ToolParameters({}));
            }
            protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
                const builder = new ResultBuilder();
                builder.add({ result: 'first', status: ResultStatus.Success });
                builder.add({ result: 'second', status: ResultStatus.Error });
                return builder.build();
            }
        }

        it('executeTool returns one entry per chain node', async () => {
            suite.add(new MultiResultTool());
            const results = await suite.executeTool('multi', '{}');
            expect(results).toHaveLength(2);
            expect(results[0]!).toMatchObject({ result: 'first', status: 'success', tool: 'multi' });
            expect(results[1]!).toMatchObject({ result: 'second', status: 'error', tool: 'multi' });
        });

        it('fires After per success and Error per error in chain', async () => {
            suite.add(new MultiResultTool());
            const afterHandler = vi.fn();
            const errorHandler = vi.fn();
            suite.hook().after().do(afterHandler);
            suite.hook().error().do(errorHandler);
            await suite.executeTool('multi', '{}');
            expect(afterHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).toHaveBeenCalledTimes(1);
        });
    });

    describe('executeTool silent', () => {
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
 });

