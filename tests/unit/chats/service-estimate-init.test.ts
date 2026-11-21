import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
    CharCountEstimator, ChatServiceConfiguration } from '../../../src/index.js';
import { ChatRole } from '@johannes.latzel/llm-chat-message';
import { TestChatService } from '../../helper/service-mocks.js';
import { createTempDir, createTempFile, removeTempDir } from '../../index.js';

function makeConfig(): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    return config;
}

describe('estimateTokens prompt initialisation', () => {
    it('loads a systemPromptFile before estimating', async () => {
        const tmpDir = createTempDir();
        try {
            createTempFile(tmpDir, 'AGENTS.md', 'File prompt');
            const config = makeConfig();
            config.systemPromptFile = path.join(tmpDir, 'AGENTS.md');
            const service = new TestChatService([], config);

            expect(service.chatImpl.getSystem()).toBeNull();

            const est = new CharCountEstimator(1);
            expect(await service.estimateTokens(est)).toBe('File prompt'.length);
            expect(service.chatImpl.getSystem()!.content).toBe('File prompt');
        } finally {
            removeTempDir(tmpDir);
        }
    });

    it('loads a systemPromptDir before estimating', async () => {
        const tmpDir = createTempDir();
        try {
            createTempFile(tmpDir, 'sys.md', 'Dir prompt');
            const config = makeConfig();
            config.systemPromptDir = tmpDir;
            const service = new TestChatService([], config);

            expect(service.chatImpl.getSystem()).toBeNull();

            const est = new CharCountEstimator(1);
            const tokens = await service.estimateTokens(est);
            expect(tokens).toBe(service.chatImpl.getSystem()!.content.length);
            expect(tokens).toBeGreaterThan(0);
        } finally {
            removeTempDir(tmpDir);
        }
    });

    it('loads user prompt files only once across estimate and send', async () => {
        const tmpDir = createTempDir();
        try {
            const userFile = createTempFile(tmpDir, 'user.md', 'User context');
            const config = makeConfig();
            config.systemPrompt = 'System';
            config.userPromptPaths = [userFile];
            const service = new TestChatService([], config);

            const est = new CharCountEstimator(1);
            const first = await service.estimateTokens(est);
            await service.send();
            const second = await service.estimateTokens(est);

            const userMessages = service.chatImpl
                .messages()
                .filter((message) => message.role === ChatRole.User);
            expect(userMessages).toHaveLength(1);
            expect(userMessages[0]!.content).toBe('User context');
            expect(second).toBe(first);
        } finally {
            removeTempDir(tmpDir);
        }
    });

    it('shares one init across concurrent estimates', async () => {
        const tmpDir = createTempDir();
        try {
            const userFile = createTempFile(tmpDir, 'user.md', 'User context');
            const config = makeConfig();
            config.userPromptPaths = [userFile];
            const service = new TestChatService([], config);

            const est = new CharCountEstimator(1);
            await Promise.all([service.estimateTokens(est), service.estimateTokens(est)]);

            const userMessages = service.chatImpl
                .messages()
                .filter((message) => message.role === ChatRole.User);
            expect(userMessages).toHaveLength(1);
        } finally {
            removeTempDir(tmpDir);
        }
    });
});
