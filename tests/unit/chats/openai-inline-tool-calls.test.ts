import { describe, it, expect } from 'vitest';
import {
    ChatRole,
    ChatServiceConfiguration,
    FinishReason,
    OpenAIChatService,
    OpenAIChatServiceConfiguration
} from '../../../src/index.js';
import { createSequencedMockOpenAI } from '../../helper/mock-openai.js';
import { SimpleTestTool } from '../../helper/service-mocks.js';

function makeService(api: ReturnType<typeof createSequencedMockOpenAI>): OpenAIChatService {
    const openAIConfig = new OpenAIChatServiceConfiguration();
    openAIConfig.model = 'test-model';

    const config = new ChatServiceConfiguration();
    config.systemPromptDir = '';
    config.userPromptPaths = [];
    config.parseInlineToolCalls = true;

    return new OpenAIChatService(api, openAIConfig, config);
}

describe('OpenAIChatService inline tool calls', () => {
    it('parses a split <tool_call> block and executes the tool', async () => {
        const api = createSequencedMockOpenAI([
            [
                { content: '<tool_call>{"name":"test_' },
                { content: 'tool","arguments":{"x":1}}</tool_call>' },
                { finish_reason: 'stop' }
            ],
            [{ content: 'done' }, { finish_reason: 'stop' }]
        ]);
        const service = makeService(api);
        service.tools().add(new SimpleTestTool('test_tool', 'ok'));
        await service.chatImpl.user('go');

        await service.send();

        const summaries = service.stream().summary();
        expect(summaries).toHaveLength(2);
        expect(summaries[0]).toMatchObject({
            content: '',
            toolCallCount: 1,
            finishReason: FinishReason.ToolCalls
        });
        expect(summaries[1]).toMatchObject({
            content: 'done',
            finishReason: FinishReason.Stop
        });

        const messages = service.chatImpl.messages();
        expect(messages.map((message) => message.role)).toEqual([
            ChatRole.User,
            ChatRole.Assistant,
            ChatRole.Tool,
            ChatRole.Assistant
        ]);
        const call = messages[1]!.tool_calls![0]!;
        expect(call.function.name).toBe('test_tool');
        expect(call.function.arguments).toBe('{"x":1}');
        expect(messages[2]!.content).toBe('ok');
        expect(messages[2]!.tool_call_id).toBe(call.id);
        expect(messages[3]!.content).toBe('done');
    });
});
