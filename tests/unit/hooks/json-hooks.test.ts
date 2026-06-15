import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonHookRegistry } from '../../../src/hooks/json-hooks.js';
import { Chat } from '../../../src/chats/chat.js';
import { ChunkStream } from '../../../src/chats/stream.js';
import { ToolSuite } from '../../../src/tools/suite.js';
import { Tool, ToolParameters, ResultStatus } from '../../../src/tools/base.js';
import type { PartialToolResult } from '../../../src/tools/base.js';

function createTempDir(): string {
    return mkdtempSync(join(tmpdir(), 'json-hooks-test-'));
}

function removeTempDir(dir: string): void {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

function writeJson(dir: string, name: string, data: unknown): void {
    writeFileSync(join(dir, name), JSON.stringify(data), 'utf-8');
}

class TestTool extends Tool {
    constructor(name: string) {
        super(name, `Tool ${name}`, new ToolParameters({}));
    }
    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        return { result: `${this.name} executed`, status: ResultStatus.Success };
    }
}

class FailingTestTool extends Tool {
    constructor(name: string) {
        super(name, `Failing ${name}`, new ToolParameters({}));
    }
    protected async onExecute(_args: Record<string, unknown>): Promise<PartialToolResult> {
        throw new Error(`${this.name} failed`);
    }
}

describe('JsonHookRegistry', () => {
    let registry: JsonHookRegistry;
    let tempDir: string;

    beforeEach(() => {
        registry = new JsonHookRegistry();
        tempDir = createTempDir();
    });

    afterEach(() => {
        registry.clear();
        removeTempDir(tempDir);
    });

    describe('basic operations', () => {
        it('starts empty', () => {
            expect(registry.size).toBe(0);
        });

        it('clear is safe on empty registry', () => {
            expect(() => registry.clear()).not.toThrow();
        });

        it('setAction and removeAction', () => {
            const handler = vi.fn();
            registry.setAction('custom', handler);
            registry.removeAction('custom');
        });
    });

    describe('load from directory', () => {
        it('loads a single hook definition', async () => {
            writeJson(tempDir, 'hook.json', { target: 'chat' });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(registry.size).toBe(1);
        });

        it('loads an array of hook definitions', async () => {
            writeJson(tempDir, 'hooks.json', [
                { target: 'chat' },
                { target: 'stream' },
            ]);
            const chat = new Chat();
            const stream = new ChunkStream();
            await registry.load(tempDir, { chat, stream });
            expect(registry.size).toBe(2);
        });

        it('skips .json files that are not valid JSON', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeFileSync(join(tempDir, 'bad.json'), 'not json', 'utf-8');
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(warnSpy).toHaveBeenCalled();
            expect(registry.size).toBe(0);
            warnSpy.mockRestore();
        });

        it('warns when directory does not exist', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const chat = new Chat();
            await registry.load(join(tempDir, 'nonexistent'), { chat });
            expect(warnSpy).toHaveBeenCalled();
            expect(registry.size).toBe(0);
            warnSpy.mockRestore();
        });

        it('only loads .json files', async () => {
            writeJson(tempDir, 'a.json', { target: 'chat' });
            writeFileSync(join(tempDir, 'b.txt'), 'hello', 'utf-8');
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(registry.size).toBe(1);
        });

        it('clear() disposes all hooks', async () => {
            writeJson(tempDir, 'hook.json', { target: 'chat' });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(registry.size).toBe(1);
            registry.clear();
            expect(registry.size).toBe(0);
        });

        it('re-loading clears previous hooks', async () => {
            writeJson(tempDir, 'hook.json', { target: 'chat' });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(registry.size).toBe(1);
            await registry.load(tempDir, { chat });
            expect(registry.size).toBe(1);
        });
    });

    describe('chat hooks', () => {
        it('fires on matching message role', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                roles: ['user'],
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const chat = new Chat();
            await registry.load(tempDir, { chat });

            await chat.user('hello');
            expect(handler).toHaveBeenCalledTimes(1);
            const callData = handler.mock.calls[0]!;
            expect(callData[0].role).toBe('user');
            expect(callData[0].content).toBe('hello');
        });

        it('does not fire for non-matching roles', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                roles: ['assistant'],
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const chat = new Chat();
            await registry.load(tempDir, { chat });

            await chat.user('hello');
            expect(handler).not.toHaveBeenCalled();
        });

        it('filters by regex', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                regex: 'error',
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const chat = new Chat();
            await registry.load(tempDir, { chat });

            await chat.user('no match');
            expect(handler).not.toHaveBeenCalled();
            await chat.user('found error here');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('respects maxTriggers', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                maxTriggers: 2,
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const chat = new Chat();
            await registry.load(tempDir, { chat });

            await chat.user('a');
            await chat.user('b');
            await chat.user('c');
            expect(handler).toHaveBeenCalledTimes(2);
        });

        it('includes match data', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                regex: '(wor)ld',
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const chat = new Chat();
            await registry.load(tempDir, { chat });

            await chat.user('hello world');
            const callData = handler.mock.calls[0]!;
            expect(callData[0].match).toBe('world');
        });
    });

    describe('stream hooks', () => {
        it('fires on matching chunk type', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'stream',
                chunks: ['content'],
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const stream = new ChunkStream();
            await registry.load(tempDir, { stream });

            stream.addContentChunk('hello');
            expect(handler).toHaveBeenCalledTimes(1);
            const callData = handler.mock.calls[0]!;
            expect(callData[0].type).toBe('content');
            expect(callData[0].text).toBe('hello');
        });

        it('does not fire for non-matching chunk types', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'stream',
                chunks: ['content'],
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const stream = new ChunkStream();
            await registry.load(tempDir, { stream });

            stream.addFinishChunk('stop' as any);
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('tool hooks', () => {
        it('fires on tool after (default event)', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'tool',
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const suite = new ToolSuite();
            suite.add(new TestTool('test_tool'));
            await registry.load(tempDir, { tools: suite });

            await suite.executeTool('test_tool', '{}');
            expect(handler).toHaveBeenCalled();
            const callData = handler.mock.calls[0]!;
            expect(callData[0].event).toBe('after');
        });

        it('fires on tool before', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'tool',
                event: 'before',
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const suite = new ToolSuite();
            suite.add(new TestTool('test_tool'));
            await registry.load(tempDir, { tools: suite });

            await suite.executeTool('test_tool', '{}');
            expect(handler).toHaveBeenCalled();
            const callData = handler.mock.calls[0]!;
            expect(callData[0].event).toBe('before');
            expect(callData[0].name).toBe('test_tool');
        });

        it('fires on tool error', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'tool',
                event: 'error',
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const suite = new ToolSuite();
            suite.add(new FailingTestTool('failing_tool'));
            await registry.load(tempDir, { tools: suite });

            await suite.executeTool('failing_tool', '{}');
            expect(handler).toHaveBeenCalled();
            const callData = handler.mock.calls[0]!;
            expect(callData[0].event).toBe('error');
            expect(callData[0].name).toBe('failing_tool');
            expect(callData[0].error).toContain('failed');
        });

        it('filters by tool name', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'tool',
                tools: ['tool_a'],
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const suite = new ToolSuite();
            suite.add(new TestTool('tool_a'));
            suite.add(new TestTool('tool_b'));
            await registry.load(tempDir, { tools: suite });

            await suite.executeTool('tool_a', '{}');
            await suite.executeTool('tool_b', '{}');
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('enabled flag', () => {
        it('skips disabled hooks', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                enabled: false,
                actions: [{ type: 'test' }],
            });
            const handler = vi.fn();
            registry.setAction('test', handler);
            const chat = new Chat();
            await registry.load(tempDir, { chat });

            await chat.user('hello');
            expect(handler).not.toHaveBeenCalled();
            expect(registry.size).toBe(0);
        });
    });

    describe('unknown target / action', () => {
        it('warns on unknown target', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'invalid' as any,
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(warnSpy).toHaveBeenCalled();
            expect(registry.size).toBe(0);
            warnSpy.mockRestore();
        });

        it('warns and skips actions when an action type is unknown', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'nonexistent' }],
            });
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(warnSpy).toHaveBeenCalled();
            expect(logSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
            logSpy.mockRestore();
        });
    });

    describe('missing targets', () => {
        it('warns when chat target is missing for chat hook', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', { target: 'chat' });
            await registry.load(tempDir, {});
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('warns when stream target is missing for stream hook', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', { target: 'stream' });
            await registry.load(tempDir, {});
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });

        it('warns when tools target is missing for tool hook', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', { target: 'tool' });
            await registry.load(tempDir, {});
            expect(warnSpy).toHaveBeenCalled();
            warnSpy.mockRestore();
        });
    });

    describe('custom actions', () => {
        it('calls registered custom action handler', async () => {
            const handler = vi.fn();
            registry.setAction('custom', handler);
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'custom' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(handler).toHaveBeenCalled();
        });
    });

    describe('template formatting', () => {
        it('preserves {{placeholder}} when key is missing from data', async () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'log', message: 'role={{role}} missing={{missing}}' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            const logged = logSpy.mock.calls[0]![0] as string;
            expect(logged).toContain('{{missing}}');
            expect(logged).toContain('role=user');
            logSpy.mockRestore();
        });
    });

    describe('invalid definitions', () => {
        it('warns when hook definition has no target', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                enabled: true,
            } as any);
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing target'));
            expect(registry.size).toBe(0);
            warnSpy.mockRestore();
        });

        it('warns on unknown tool event', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'tool',
                event: 'invalid',
            });
            const suite = new ToolSuite();
            suite.add(new TestTool('some_tool'));
            await registry.load(tempDir, { tools: suite });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown tool event'));
            expect(registry.size).toBe(0);
            warnSpy.mockRestore();
        });

        it('warns on unknown chunk type', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'stream',
                chunks: ['invalid_chunk_type'],
            });
            const stream = new ChunkStream();
            await registry.load(tempDir, { stream });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown chunk type'));
            warnSpy.mockRestore();
        });

        it('warns on unknown role', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                roles: ['unknown_role'],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unknown role'));
            warnSpy.mockRestore();
        });
    });

    describe('branch coverage', () => {
        it('defaultMessage uses label prefix when label is set', async () => {
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                label: 'my-label',
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            const logged = logSpy.mock.calls[0]![0] as string;
            expect(logged).toContain('[json-hook my-label]');
            logSpy.mockRestore();
        });

        it('stream hook spread works for non-text chunks', async () => {
            const handler = vi.fn();
            registry.setAction('test', handler);
            writeJson(tempDir, 'hook.json', {
                target: 'stream',
                actions: [{ type: 'test' }],
            });
            const stream = new ChunkStream();
            await registry.load(tempDir, { stream });

            stream.addFinishChunk('stop' as any);
            expect(handler).toHaveBeenCalled();
            const callData = handler.mock.calls[0]!;
            expect(callData[0].type).toBe('finish');
            expect(callData[0].text).toBeUndefined();
        });

        it('stream hook includes toolCallId when present', async () => {
            const handler = vi.fn();
            registry.setAction('test', handler);
            writeJson(tempDir, 'hook.json', {
                target: 'stream',
                actions: [{ type: 'test' }],
            });
            const stream = new ChunkStream();
            await registry.load(tempDir, { stream });

            stream.addToolCallDeltaChunk('{"key":', 0, 'call_abc');
            expect(handler).toHaveBeenCalled();
            const callData = handler.mock.calls[0]!;
            expect(callData[0].type).toBe('tool_call_delta');
            expect(callData[0].toolCallId).toBe('call_abc');
        });

        it('stream hook skips toolCallId when empty string', async () => {
            const handler = vi.fn();
            registry.setAction('test', handler);
            writeJson(tempDir, 'hook.json', {
                target: 'stream',
                actions: [{ type: 'test' }],
            });
            const stream = new ChunkStream();
            await registry.load(tempDir, { stream });

            stream.addToolCallDeltaChunk('{"key":', 0, '');
            expect(handler).toHaveBeenCalled();
            const callData = handler.mock.calls[0]!;
            expect(callData[0].type).toBe('tool_call_delta');
            expect(callData[0].toolCallId).toBeUndefined();
        });

        it('tool error hook includes error message', async () => {
            const handler = vi.fn();
            registry.setAction('test', handler);
            writeJson(tempDir, 'hook.json', {
                target: 'tool',
                event: 'error',
                actions: [{ type: 'test' }],
            });
            const suite = new ToolSuite();
            await registry.load(tempDir, { tools: suite });

            (suite as any).emit('error', 'test_tool', new Error('something broke'));

            expect(handler).toHaveBeenCalled();
            const callData = handler.mock.calls[0]!;
            expect(callData[0].error).toBe('something broke');
        });
    });

    describe('built-in actions', () => {
        it('log action calls console.log', async () => {
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'log' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it('warn action calls console.warn', async () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'warn' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it('info action calls console.info', async () => {
            const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'info' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it('debug action calls console.debug', async () => {
            const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'debug' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });

        it('inject is a no-op when no service is wired', async () => {
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'queue-message', role: 'user', message: 'should not appear' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await expect(chat.user('hello')).resolves.toBeUndefined();
        });
    });

    describe('composite actions', () => {
        it('single string still works', async () => {
            const handler = vi.fn();
            registry.setAction('custom', handler);
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'custom' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('array fires handlers in order', async () => {
            const order: string[] = [];
            registry.setAction('first', () => { order.push('first'); });
            registry.setAction('second', () => { order.push('second'); });
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'first' }, { type: 'second' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(order).toEqual(['first', 'second']);
        });

        it('stops processing actions after an unknown action type', async () => {
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const executed: string[] = [];
            registry.setAction('custom', () => { executed.push('custom'); });
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [{ type: 'custom' }, { type: 'nonexistent' }],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(executed).toEqual(['custom']);
            expect(warnSpy).toHaveBeenCalled();
            expect(logSpy).not.toHaveBeenCalled();
            warnSpy.mockRestore();
            logSpy.mockRestore();
        });

        it('empty array defaults to log', async () => {
            const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
            writeJson(tempDir, 'hook.json', {
                target: 'chat',
                actions: [],
            });
            const chat = new Chat();
            await registry.load(tempDir, { chat });
            await chat.user('hello');
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });
});
