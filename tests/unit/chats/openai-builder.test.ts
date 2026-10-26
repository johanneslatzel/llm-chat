import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import {
    ChatServiceConfiguration,
    OpenAIChatService,
    OpenAIChatServiceBuilder,
    OpenAIChatServiceConfiguration
} from '../../../src/index.js';
import { createMockOpenAI, createTempDir, createTempFile, removeTempDir } from '../../index.js';
import { makeChunks } from '../../helper/openai-mocks.js';

function createClient() {
    return createMockOpenAI(makeChunks([{ content: 'Hi' }, { finish_reason: 'stop' }]));
}

describe('OpenAIChatServiceBuilder', () => {
    it('builds a service with a model and client', async () => {
        const client = createClient();
        const service = OpenAIChatService.builder()
            .model('test-model')
            .withClient(client)
            .create();

        expect(service).toBeInstanceOf(OpenAIChatService);

        await service.send();
        const call = (client.chat.completions.create as any).mock.calls[0][0];
        expect(call.model).toBe('test-model');
    });

    it('creates a default OpenAI client', () => {
        vi.stubEnv('OPENAI_API_KEY', 'test-key');
        const service = new OpenAIChatServiceBuilder().model('test-model').create();
        expect(service).toBeInstanceOf(OpenAIChatService);
        vi.unstubAllEnvs();
    });

    it('sets sampling and token limits', async () => {
        const client = createClient();
        const service = new OpenAIChatServiceBuilder()
            .model('test-model')
            .temperature(0.3)
            .maxTokens(1024)
            .maxCompletionTokens(2048)
            .withClient(client)
            .create();

        await service.send();
        const call = (client.chat.completions.create as any).mock.calls[0][0];
        expect(call.temperature).toBe(0.3);
        expect(call.max_completion_tokens).toBe(2048);
        expect(call.max_tokens).toBeUndefined();
    });

    it('sets a flat system prompt', async () => {
        const service = new OpenAIChatServiceBuilder()
            .model('test-model')
            .withClient(createClient())
            .systemPrompt('Be brief.')
            .create();

        await service.init();
        expect(service.chat().getSystem()!.content).toBe('Be brief.');
    });

    it('sets a system prompt file', async () => {
        const tmpDir = createTempDir();
        try {
            const filePath = path.join(tmpDir, 'AGENTS.md');
            createTempFile(tmpDir, 'AGENTS.md', 'From the file');
            const service = new OpenAIChatServiceBuilder()
                .model('test-model')
                .withClient(createClient())
                .systemPromptFile(filePath)
                .create();

            await service.init();
            expect(service.chat().getSystem()!.content).toBe('From the file');
        } finally {
            removeTempDir(tmpDir);
        }
    });

    it('lets the last system prompt setter win', async () => {
        const tmpDir = createTempDir();
        try {
            const filePath = path.join(tmpDir, 'AGENTS.md');
            createTempFile(tmpDir, 'AGENTS.md', 'From the file');

            const flatWins = new OpenAIChatServiceBuilder()
                .model('test-model')
                .withClient(createClient())
                .systemPromptFile(filePath)
                .systemPrompt('Flat prompt')
                .create();
            await flatWins.init();
            expect(flatWins.chat().getSystem()!.content).toBe('Flat prompt');

            const fileWins = new OpenAIChatServiceBuilder()
                .model('test-model')
                .withClient(createClient())
                .systemPrompt('Flat prompt')
                .systemPromptFile(filePath)
                .create();
            await fileWins.init();
            expect(fileWins.chat().getSystem()!.content).toBe('From the file');
        } finally {
            removeTempDir(tmpDir);
        }
    });

    it('uses provided configs', async () => {
        const openAIConfig = new OpenAIChatServiceConfiguration();
        openAIConfig.model = 'configured-model';
        const serviceConfig = new ChatServiceConfiguration();
        serviceConfig.systemPrompt = 'Configured prompt';

        const service = new OpenAIChatServiceBuilder()
            .withClient(createClient())
            .withOpenAIConfig(openAIConfig)
            .withServiceConfig(serviceConfig)
            .create();

        await service.init();
        expect(service.chat().getSystem()!.content).toBe('Configured prompt');
    });
});
