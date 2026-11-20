import { describe, it, expect } from 'vitest';
import {
    CharCountEstimator,
    ChatMessageOrigin,
    ChatRole,
    ChatServiceConfiguration,
    type ToolCall
} from '../../../src/index.js';
import { TestChatService, SimpleTestTool } from '../../helper/service-mocks.js';

function makeConfig(): ChatServiceConfiguration {
    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    return config;
}

describe('estimateTokens with tool-call payloads', () => {
    it('counts serialized tool_calls on assistant messages', async () => {
        const service = new TestChatService([], makeConfig());
        const toolCalls: ToolCall[] = [
            { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{"x":1}' } }
        ];
        await service.chatImpl.assistant('', toolCalls);

        const est = new CharCountEstimator(1);
        expect(await service.estimateTokens(est)).toBe(JSON.stringify(toolCalls).length);
    });

    it('counts tool_call_id on tool messages', async () => {
        const service = new TestChatService([], makeConfig());
        await service.chatImpl.tool('result', 'call_1');

        const est = new CharCountEstimator(1);
        expect(await service.estimateTokens(est)).toBe('result'.length + 'call_1'.length);
    });

    it('counts the payload of an injected tool call', async () => {
        const service = new TestChatService([], makeConfig());
        service.tools().add(new SimpleTestTool('my_tool', 'ok'));

        const est = new CharCountEstimator(1);
        const toolDefinitionTokens = await service.estimateTokens(est);
        await service.injectToolCall('my_tool', {});

        const [assistantMessage, toolMessage] = await (service as any)._messageQueue.messages();
        expect(await service.estimateTokens(est)).toBe(
            toolDefinitionTokens +
                JSON.stringify(assistantMessage.tool_calls).length +
                toolMessage.content.length +
                toolMessage.tool_call_id.length
        );
    });

    it('does not count a missing tool_call_id', async () => {
        const service = new TestChatService([], makeConfig());
        service.chatImpl._rawMessages().push({
            role: ChatRole.Tool,
            content: 'result',
            createdAt: new Date(),
            origin: ChatMessageOrigin.Tool
        });

        const est = new CharCountEstimator(1);
        expect(await service.estimateTokens(est)).toBe('result'.length);
    });

    it('keeps plain messages unchanged', async () => {
        const service = new TestChatService([], makeConfig());
        await service.chatImpl.user('hello');
        await service.chatImpl.assistant('hi');

        const est = new CharCountEstimator(1);
        expect(await service.estimateTokens(est)).toBe('hello'.length + 'hi'.length);
    });
});
