import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolSuite, ToolEvent } from '../../../src/tools/suite.js';
import { AlphaTool, BetaTool, AlphaBetaPackage, TutorialPackage } from '../../helper/tool-mocks.js';
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
});
