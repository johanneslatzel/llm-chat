import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { ChatServiceConfiguration, ChatMessageOrigin } from '../../../src/index.js';
import { createTempDir, removeTempDir } from '../../index.js';
import { TestChatService } from '../../helper/service-mocks.js';

describe('ChatService json hook integration', () => {
    let hooksDir: string;

    beforeEach(() => {
        hooksDir = createTempDir();
    });

    afterEach(() => {
        removeTempDir(hooksDir);
    });

    it('loadJsonHooks loads hook files from hooksDir', async () => {
        writeFileSync(
            path.join(hooksDir, 'test-hook.json'),
            JSON.stringify({ target: 'chat' }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);

        await service.loadJsonHooks();

        expect((service as any)._jsonHookRegistry.size).toBe(1);
    });

    it('getJsonHooks returns label and target for each loaded hook', async () => {
        writeFileSync(
            path.join(hooksDir, 'a.json'),
            JSON.stringify({ label: 'hook-a', target: 'chat' }),
            'utf-8'
        );
        writeFileSync(
            path.join(hooksDir, 'b.json'),
            JSON.stringify({ label: 'hook-b', target: 'stream' }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        const infos = service.getJsonHooks();
        expect(infos).toHaveLength(2);
        expect(infos[0]!.label).toBe('hook-a');
        expect(infos[0]!.target).toBe('chat');
        expect(infos[1]!.label).toBe('hook-b');
        expect(infos[1]!.target).toBe('stream');
    });

    it('loadJsonHooks is a no-op when hooksDir is not set', async () => {
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        const service = new TestChatService([], cfg);

        await service.loadJsonHooks();

        expect((service as any)._jsonHookRegistry.size).toBe(0);
    });

    it('auto-loads JSON hooks during init', async () => {
        writeFileSync(
            path.join(hooksDir, 'test-hook.json'),
            JSON.stringify({ target: 'chat' }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);

        await service.init();

        expect((service as any)._jsonHookRegistry.size).toBe(1);
    });

    it('interrupt action aborts the controller', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook.json'),
            JSON.stringify({ target: 'chat', actions: [{ type: 'interrupt' }] }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        const abort = vi.fn();
        (service as any)._abortController = { abort };
        await service.loadJsonHooks();
        await service.chatImpl.user('hello');
        expect(abort).toHaveBeenCalledTimes(1);
    });

    it('interrupt-resend action sets needsResend', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook.json'),
            JSON.stringify({ target: 'chat', actions: [{ type: 'interrupt', resend: true }] }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        await service.chatImpl.user('hello');
        expect((service as any)._needsResend).toBe(true);
    });

    it('queue-resend action sets needsResend without aborting', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook.json'),
            JSON.stringify({ target: 'chat', actions: [{ type: 'queue-resend' }] }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        const abort = vi.fn();
        (service as any)._abortController = { abort };
        await service.loadJsonHooks();
        await service.chatImpl.user('hello');
        expect((service as any)._needsResend).toBe(true);
        expect(abort).not.toHaveBeenCalled();
    });

    it('inject action queues a message (drained on send)', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook.json'),
            JSON.stringify({
                target: 'chat',
                actions: [{ type: 'queue-message', role: 'assistant', message: 'injected: {{content}}' }],
            }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        await service.chatImpl.user('trigger');
        await service.send();
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(2);
        expect(messages[0]!.role).toBe('user');
        expect(messages[0]!.content).toBe('trigger');
        expect(messages[1]!.role).toBe('assistant');
        expect(messages[1]!.content).toBe('injected: trigger');
        expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
    });

    it('inject action with user role queues a user message', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook-user.json'),
            JSON.stringify({
                target: 'chat',
                actions: [{ type: 'queue-message', role: 'user', message: 'auto: {{content}}' }],
            }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        await service.chatImpl.user('trigger');
        await service.send();
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(2);
        expect(messages[0]!.role).toBe('user');
        expect(messages[0]!.content).toBe('trigger');
        expect(messages[1]!.role).toBe('user');
        expect(messages[1]!.content).toBe('auto: trigger');
        expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
    });

    it('inject action with reasoning role queues a reasoning message', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook-reasoning.json'),
            JSON.stringify({
                target: 'chat',
                actions: [{ type: 'queue-message', role: 'reasoning', message: 'thinking: {{content}}' }],
            }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        await service.chatImpl.user('trigger');
        await service.send();
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(2);
        expect(messages[0]!.role).toBe('user');
        expect(messages[1]!.role).toBe('reasoning');
        expect(messages[1]!.content).toBe('thinking: trigger');
        expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
    });

    it('inject action with tool role queues a tool message', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook-tool.json'),
            JSON.stringify({
                target: 'chat',
                actions: [{ type: 'queue-message', role: 'tool', message: 'result: {{content}}' }],
            }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        await service.chatImpl.user('trigger');
        await service.send();
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(2);
        expect(messages[0]!.role).toBe('user');
        expect(messages[1]!.role).toBe('tool');
        expect(messages[1]!.content).toBe('result: trigger');
        expect((messages[1] as any).tool_call_id).toMatch(/^inject-/);
        expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
    });

    it('inject without message field uses defaultMessage', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook-no-msg.json'),
            JSON.stringify({
                target: 'chat',
                actions: [{ type: 'queue-message', role: 'user' }],
            }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        await service.chatImpl.user('hello');
        await service.send();
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(2);
        expect(messages[1]!.content).toContain('[json-hook]');
        expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
    });

    it('inject without explicit role defaults to assistant', async () => {
        writeFileSync(
            path.join(hooksDir, 'hook-no-role.json'),
            JSON.stringify({
                target: 'chat',
                actions: [{ type: 'queue-message', message: 'default role: {{content}}' }],
            }),
            'utf-8'
        );
        const cfg = new ChatServiceConfiguration();
        cfg.systemPromptDir = '';
        cfg.hooksDir = hooksDir;
        const service = new TestChatService([], cfg);
        await service.loadJsonHooks();
        await service.chatImpl.user('hello');
        await service.send();
        const messages = service.chatImpl.messages();
        expect(messages).toHaveLength(2);
        expect(messages[1]!.role).toBe('assistant');
        expect(messages[1]!.content).toBe('default role: hello');
        expect(messages[1]!.origin).toBe(ChatMessageOrigin.Hook);
    });
});