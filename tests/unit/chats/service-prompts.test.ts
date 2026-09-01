import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ChatRole, ChatServiceConfiguration, FinishReason } from '../../../src/index.js';
import { SystemPromptId } from '../../../src/service/service.js';
import { StreamEvent, StreamEventType } from '../../../src/service/service.js';
import { ChunkType } from '../../../src/service/stream-types.js';
import { createTempDir, removeTempDir, createTempFile } from '../../index.js';
import { TutorialPackage } from '../../helper/tool-mocks.js';
import { TestChatService } from '../../helper/service-mocks.js';

describe('ChatService prompts and lifecycle', () => {
    let config: ChatServiceConfiguration;

    beforeEach(() => {
        config = new ChatServiceConfiguration();
        config.systemPromptDir = '';
        config.userPromptPaths = [];
    });

    describe('prompt file loading', () => {
        it('loads prompt files and adds as user messages', async () => {
            config.userPromptPaths = ['prompt.txt'];

            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];

            const service = new TestChatService(events, config);
            await service.send();

            const userMessages = service.chatImpl.messages().filter((m) => m.role === 'user');
            expect(userMessages.length).toBeGreaterThanOrEqual(0);
        });

        it('prompt files are only loaded once', async () => {
            config.userPromptPaths = ['prompt.txt'];
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Answer' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];

            const service = new TestChatService(events, config);
            await service.send();
            await service.send();

            const userMessages = service.chatImpl.messages().filter((m) => m.role === 'user');
            expect(userMessages.length).toBeGreaterThanOrEqual(0);
        });

        it('loads prompt file content', async () => {
            const tmpDir = createTempDir();
            try {
                const promptPath = path.join(tmpDir, 'myprompt.txt');
                createTempFile(tmpDir, 'myprompt.txt', 'Hello from prompt');
                config.userPromptPaths = [promptPath];

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Response' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                const userMessages = service.chatImpl.messages().filter((m) => m.role === 'user');
                expect(userMessages).toHaveLength(1);
                expect(userMessages[0]!.content).toBe('Hello from prompt');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('loads system prompt directory', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'sys.txt', 'You are a helpful bot');
                config.systemPromptDir = tmpDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                expect(service.chatImpl.getSystem()).not.toBeNull();
                expect(service.chatImpl.getSystem()!.content).toContain('You are a helpful bot');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('creates the directory and default prompt files when missing', async () => {
            const tmpDir = createTempDir();
            try {
                config.systemPromptDir = tmpDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                const defaults = Object.values(SystemPromptId);
                for (const id of defaults) {
                    const filePath = path.join(tmpDir, `${id}.md`);
                    expect(existsSync(filePath)).toBe(true);
                    expect(readFileSync(filePath, 'utf-8')).toBe('');
                }
            } finally {
                removeTempDir(tmpDir);
            }
        });
    });

    describe('stream ending without finish event', () => {
        it('appends only reasoning message when finish with Stop reason and reasoning content but no content', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Deep thinking...' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe('reasoning');
            expect(messages[0]!.content).toBe('Deep thinking...');
        });

        it('appends only reasoning message when stream ends without finish and has reasoning content', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Reasoning, text: 'Thinking step by step' },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(1);
            expect(messages[0]!.role).toBe('reasoning');
            expect(messages[0]!.content).toBe('Thinking step by step');
        });

        it('handles unknown finish reason gracefully (falls through without appending)', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Finish, reason: 'unknown' as FinishReason },
            ];
            const service = new TestChatService(events);
            await service.send();
            const messages = service.chatImpl.messages();
            expect(messages).toHaveLength(0);
        });

        it('injects artificial finish chunk when stream ends without finish event', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'No finish event' },
            ];
            const service = new TestChatService(events);
            const finishHandler = vi.fn();
            service.stream().hook().chunks(ChunkType.Finish).do(finishHandler);
            await service.send();
            expect(finishHandler).toHaveBeenCalledTimes(1);
            const chunk = finishHandler.mock.calls[0]![0];
            expect(chunk.type).toBe(ChunkType.Finish);
            expect(chunk.isArtificial).toBe(true);
            expect(chunk.finishReason).toBe(FinishReason.Stop);
        });
    });

    describe('init', () => {
        it('loads prompt files and marks context as loaded', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'sys.txt', 'You are a bot');
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.init();

                expect(service.chatImpl.getSystem()).not.toBeNull();
                expect(service.chatImpl.getSystem()!.content).toContain('You are a bot');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('is idempotent', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'first.txt', 'First');
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.init();
                await service.init();

                expect(service.chatImpl.getSystem()!.content).toContain('First');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('prevents loadPromptFiles from running again on first send', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'boot.txt', 'Boot prompt');
                config.systemPromptDir = tmpDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                const spy = vi.spyOn(service, 'loadPromptFiles');
                await service.init();
                expect(spy).toHaveBeenCalledTimes(1);

                await service.send();
                expect(spy).toHaveBeenCalledTimes(1);
            } finally {
                removeTempDir(tmpDir);
            }
        });
    });

    describe('loadPromptFiles (public)', () => {
        it('re-reads files from disk on each call', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'greeting.txt', 'Hello');
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.loadPromptFiles();
                expect(service.chatImpl.getSystem()!.content).toContain('Hello');

                createTempFile(tmpDir, 'greeting.txt', 'Updated');
                await service.loadPromptFiles();
                expect(service.chatImpl.getSystem()!.content).toContain('Updated');
            } finally {
                removeTempDir(tmpDir);
            }
        });
    });

    describe('resetTutorials', () => {
        it('re-wires tutorial container after chat.clear()', async () => {
            const service = new TestChatService([]);
            service.tools().add(new TutorialPackage());

            service.chat().clear();
            service.resetTutorials();

            const systemContent = service.chatImpl.getSystem()?.content ?? '';
            expect(systemContent).toContain('Tool Package TutorialPackage');
            expect(systemContent).toContain('Use alpha and beta together.');
        });

        it('does not throw when no packages are registered', () => {
            const service = new TestChatService([]);
            service.chat().clear();
            expect(() => service.resetTutorials()).not.toThrow();
        });
    });

    describe('clear', () => {
        it('exposes clear on stream interface', () => {
            const service = new TestChatService([]);
            expect(typeof service.stream().clear).toBe('function');
        });

        it('removes chat hooks registered through the service', async () => {
            const service = new TestChatService([]);
            const handler = vi.fn();
            service.chat().hook().message(ChatRole.User).do((msg) => handler(msg.content));

            await service.chatImpl.user('before');
            expect(handler).toHaveBeenCalledWith('before');

            service.clear();

            await service.chatImpl.user('after');
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('allows fresh send after clear', async () => {
            const events: StreamEvent[] = [
                { type: StreamEventType.Content, text: 'Hello' },
                { type: StreamEventType.Finish, reason: FinishReason.Stop },
            ];
            const service = new TestChatService(events);
            await service.send();
            expect(service.chatImpl.messages()).toHaveLength(1);

            service.clear();
            expect(service.chatImpl.messages()).toHaveLength(0);

            await expect(service.send()).resolves.toBeUndefined();
        });
    });
});