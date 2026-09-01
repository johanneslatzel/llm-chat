import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonHookRegistry } from '../../../src/hooks/json-hooks.js';
import { Chat } from '../../../src/chat/chat.js';
import { ChunkStream } from '../../../src/service/stream.js';
import { ToolSuite } from '../../../src/tools/suite.js';
import { TestTool } from '../../helper/json-hooks-helpers.js';
import { createTempDir, removeTempDir, writeJson } from '../../helper/json-hooks-helpers.js';

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
});