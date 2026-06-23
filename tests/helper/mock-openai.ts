import { vi } from 'vitest';
import OpenAI from 'openai';
import type { ChatCompletionChunk } from 'openai/resources/chat/completions';

export interface MockChunk {
    content?: string;
    reasoning_content?: string;
    reasoning?: string;
    reasoning_details?: Array<Record<string, unknown>>;
    tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
    }>;
    finish_reason?: 'stop' | 'tool_calls' | 'length' | null;
}

export function createChunk(delta: MockChunk): ChatCompletionChunk {
    const choice: ChatCompletionChunk.Choice = {
        index: 0,
        delta: {
            content: delta.content ?? null,
            ...(delta.reasoning_content ? { reasoning_content: delta.reasoning_content } : {}),
            ...(delta.reasoning ? { reasoning: delta.reasoning } : {}),
            ...(delta.reasoning_details ? { reasoning_details: delta.reasoning_details } : {}),
            tool_calls: delta.tool_calls
                ? delta.tool_calls.map((tc) => ({
                      index: tc.index,
                      id: tc.id ?? null,
                      function: tc.function
                          ? {
                                name: tc.function.name ?? null,
                                arguments: tc.function.arguments ?? null
                            }
                          : undefined
                  }))
                : undefined
        } as ChatCompletionChunk.Choice.Delta,
        finish_reason: delta.finish_reason ?? null
    };
    return {
        id: `chatcmpl-${Math.random().toString(36).slice(2, 10)}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'test-model',
        choices: [choice],
        usage: null
    } as ChatCompletionChunk;
}

function createStreamFromChunks(chunks: MockChunk[]): AsyncIterable<ChatCompletionChunk> {
    const items = chunks.map(createChunk);
    return {
        [Symbol.asyncIterator]() {
            let i = 0;
            return {
                next: async () => {
                    if (i >= items.length) {
                        return { done: true, value: undefined as unknown as ChatCompletionChunk };
                    }
                    return { done: false, value: items[i++]! };
                }
            };
        }
    };
}

export function createMockOpenAI(chunks: MockChunk[]): OpenAI {
    const stream = createStreamFromChunks(chunks);
    const mockCreate = vi.fn().mockReturnValue(Promise.resolve(stream));

    return {
        apiKey: 'test-key',
        chat: {
            completions: {
                create: mockCreate
            }
        }
    } as unknown as OpenAI;
}

export function createMockOpenAIWithError(error: Error): OpenAI {
    const mockCreate = vi.fn().mockRejectedValue(error);

    return {
        apiKey: 'test-key',
        chat: {
            completions: {
                create: mockCreate
            }
        }
    } as unknown as OpenAI;
}
