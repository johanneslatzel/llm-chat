import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ChatRole, ChatServiceConfiguration, FinishReason } from '../../../src/index.js';
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

        it('loads multiple system prompt files in name order', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'b.txt', 'Second');
                createTempFile(tmpDir, 'a.txt', 'First');
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.init();

                const content = service.chatImpl.getSystem()!.content;
                expect(content).toContain('First');
                expect(content).toContain('Second');
                expect(content.indexOf('First')).toBeLessThan(content.indexOf('Second'));
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('does not create the directory when it is missing', async () => {
            const tmpDir = createTempDir();
            try {
                const missingDir = path.join(tmpDir, 'missing-prompts');
                config.systemPromptDir = missingDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                expect(existsSync(missingDir)).toBe(false);
                expect(service.chatImpl.getSystem()).toBeNull();
            } finally {
                removeTempDir(tmpDir);
            }
        });
    });

    describe('flat system prompt', () => {
        it('does not load or create prompt files when systemPrompt is set', async () => {
            const tmpDir = createTempDir();
            try {
                const missingDir = path.join(tmpDir, 'flat-prompts');
                config.systemPrompt = 'You are a flat assistant.';
                config.systemPromptDir = missingDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                expect(existsSync(missingDir)).toBe(false);
                expect(service.chatImpl.getSystem()).not.toBeNull();
                expect(service.chatImpl.getSystem()!.content).toBe('You are a flat assistant.');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('still loads user prompt files when systemPrompt is set', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'user.txt', 'User prompt');
                config.systemPrompt = 'You are a flat assistant.';
                config.userPromptPaths = [path.join(tmpDir, 'user.txt')];

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                await service.send();

                const userMessages = service.chatImpl.messages().filter((m) => m.role === 'user');
                expect(userMessages).toHaveLength(1);
                expect(userMessages[0]!.content).toBe('User prompt');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('treats an empty systemPrompt as unset', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'sys.txt', 'Boot prompt');
                config.systemPrompt = '';
                config.systemPromptDir = tmpDir;

                const service = new TestChatService([], config);
                await service.init();

                expect(service.chatImpl.getSystem()!.content).toContain('Boot prompt');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('loads a single system prompt file', async () => {
            const tmpDir = createTempDir();
            try {
                const filePath = path.join(tmpDir, 'AGENTS.md');
                createTempFile(tmpDir, 'AGENTS.md', '# AGENTS\nBe concise.');
                config.systemPromptFile = filePath;

                const service = new TestChatService([], config);
                await service.init();

                expect(service.chatImpl.getSystem()!.content).toBe('# AGENTS\nBe concise.');
                expect(service.chatImpl.system().child('general').hasContent()).toBe(false);
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('gives systemPrompt precedence over systemPromptFile', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'AGENTS.md', 'From file');
                config.systemPrompt = 'From config';
                config.systemPromptFile = path.join(tmpDir, 'AGENTS.md');

                const service = new TestChatService([], config);
                await service.loadPromptFiles();

                expect(service.chatImpl.getSystem()!.content).toBe('From config');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('throws when the system prompt file is missing', async () => {
            const tmpDir = createTempDir();
            try {
                config.systemPromptFile = path.join(tmpDir, 'missing.md');
                const service = new TestChatService([], config);

                await expect(service.init()).rejects.toThrow('Failed to load system prompt file');
                await expect(service.init()).rejects.toThrow('Failed to load system prompt file');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('does nothing when no system prompt file is configured', async () => {
            const service = new TestChatService([], config);
            await expect((service as any).loadSystemPromptFile()).resolves.toBeUndefined();
        });

        it('reloads the system prompt file with loadPromptFiles', async () => {
            const tmpDir = createTempDir();
            try {
                const filePath = path.join(tmpDir, 'AGENTS.md');
                createTempFile(tmpDir, 'AGENTS.md', 'First version');
                config.systemPromptFile = filePath;

                const service = new TestChatService([], config);
                await service.loadPromptFiles();
                expect(service.chatImpl.getSystem()!.content).toBe('First version');

                createTempFile(tmpDir, 'AGENTS.md', 'Second version');
                await service.loadPromptFiles();
                expect(service.chatImpl.getSystem()!.content).toBe('Second version');
            } finally {
                removeTempDir(tmpDir);
            }
        });

        it('reloads the system prompt file after clear', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'AGENTS.md', 'Persistent prompt');
                config.systemPromptFile = path.join(tmpDir, 'AGENTS.md');

                const service = new TestChatService([], config);
                await service.init();
                expect(service.chatImpl.getSystem()!.content).toBe('Persistent prompt');

                service.clear();
                expect(service.chatImpl.getSystem()).toBeNull();

                await service.init();
                expect(service.chatImpl.getSystem()!.content).toBe('Persistent prompt');
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

        it('prevents system prompt files from loading again on first send', async () => {
            const tmpDir = createTempDir();
            try {
                createTempFile(tmpDir, 'boot.txt', 'Boot prompt');
                config.systemPromptDir = tmpDir;

                const events: StreamEvent[] = [
                    { type: StreamEventType.Content, text: 'Answer' },
                    { type: StreamEventType.Finish, reason: FinishReason.Stop },
                ];

                const service = new TestChatService(events, config);
                const spy = vi.spyOn(service as any, 'loadSystemPromptFiles');
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