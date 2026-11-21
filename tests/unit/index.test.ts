import { describe, expect, it } from 'vitest';
import * as llmChat from '../../src/index.js';

describe('package exports', () => {
    it('exports the abstract chat engine surface', () => {
        expect(llmChat.ChatServiceConfiguration).toBeDefined();
        expect(llmChat.ChatService).toBeDefined();
        expect(llmChat.ChunkType).toBeDefined();
        expect(llmChat.ChatHookBuilder).toBeDefined();
        expect(llmChat.Prompt).toBeDefined();
    });

    it('does not re-export tool, hook, result, or message primitives', () => {
        const removed = [
            'Tool',
            'ToolPackage',
            'ToolParameters',
            'ToolParameterProperty',
            'PropertyType',
            'ResultStatus',
            'ResultBuilder',
            'ToolResult',
            'PartialToolResult',
            'Hook',
            'HookBuilderBase',
            'HasHooks',
            'ChatRole',
            'ChatMessageOrigin',
            'FinishReason',
            'ChatMessage',
            'ToolCall',
            'MessageWriter',
            'OpenAIChatService',
            'OpenAIChatServiceBuilder',
            'OpenAIChatServiceConfiguration',
            'ReasoningEffort',
            'ToolChoice',
            'Verbosity'
        ];
        for (const name of removed) {
            expect(name in llmChat, `llm-chat must not re-export ${name}`).toBe(false);
        }
    });
});
