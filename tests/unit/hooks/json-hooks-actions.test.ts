import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonHookRegistry } from '../../../src/hooks/json-hooks.js';
import { Chat } from '../../../src/chat/chat.js';
import { ChunkStream } from '../../../src/service/stream.js';
import { ToolSuite } from '../../../src/tools/suite.js';
import { createTempDir, removeTempDir, writeJson } from '../../helper/json-hooks-helpers.js';

describe('JsonHookRegistry actions', () => {
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