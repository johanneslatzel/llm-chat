import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonHookRegistry } from '../../../src/hooks/json-hooks.js';
import { Chat } from '../../../src/chat/chat.js';
import { ChunkStream } from '../../../src/service/stream.js';
import { ToolSuite } from '../../../src/tools/suite.js';
import { TestTool, FailingTestTool } from '../../helper/json-hooks-helpers.js';
import { createTempDir, removeTempDir, writeJson } from '../../helper/json-hooks-helpers.js';

describe('JsonHookRegistry targets', () => {
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
});