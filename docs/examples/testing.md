# Testing

A `ChatService` subclass is the seam for deterministic tests. Implement
`createStream()` to replay scripted `StreamEvent` values, and the whole tool
loop runs without a network or a provider package.

This example runs one tool-call round and one final answer against a scripted
service. It uses `node:assert` so the script runs without a test framework.

```typescript
import assert from 'node:assert/strict';
import {
    ChatService,
    ChatServiceConfiguration,
    StreamEventType,
    type StreamEvent,
} from '@johannes.latzel/llm-chat';
import { ChatRole, FinishReason } from '@johannes.latzel/llm-chat-message';
import {
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult,
} from '@johannes.latzel/llm-chat-tool';

class ScriptedChatService extends ChatService {
    private index = 0;

    constructor(
        private rounds: StreamEvent[][],
        config?: ChatServiceConfiguration,
    ) {
        super(config);
    }

    roundsPlayed(): number {
        return this.index;
    }

    protected async *createStream(_signal?: AbortSignal): AsyncIterable<StreamEvent> {
        const round = this.rounds[this.index++] ?? [];
        for (const event of round) {
            yield event;
        }
    }
}

class LookupOrderTool extends Tool {
    constructor() {
        super(
            'lookup_order',
            'Look up an order by ID.',
            new ToolParameters(
                { id: ToolParameterProperty.string('Order ID') },
                ['id'],
            ),
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return typeof args.id === 'string'
            ? { result: `Order ${args.id}: shipped`, status: ResultStatus.Success }
            : { result: 'id must be a string', status: ResultStatus.Error };
    }
}

const rounds: StreamEvent[][] = [
    [
        {
            type: StreamEventType.ToolCallDelta,
            index: 0,
            id: 'call_1',
            name: 'lookup_order',
            arguments: '{"id":"42"}',
        },
        { type: StreamEventType.Finish, reason: FinishReason.ToolCalls },
    ],
    [
        { type: StreamEventType.Content, text: 'Order 42 is shipped.' },
        { type: StreamEventType.Finish, reason: FinishReason.Stop },
    ],
];

const config = new ChatServiceConfiguration();
config.systemPrompt = 'Use tools when they provide data.';
config.systemPromptDir = '';

const service = new ScriptedChatService(rounds, config);
service.tools().add(new LookupOrderTool());

await service.chat().user('Where is order 42?');
await service.send();

const messages = service.chat().messages();

assert.equal(service.roundsPlayed(), 2);
assert.ok(
    messages.some(
        (message) =>
            message.role === ChatRole.Tool &&
            message.content === 'Order 42: shipped',
    ),
);
assert.equal(messages.at(-1)?.content, 'Order 42 is shipped.');

console.log('Tool loop completed without a network request.');
```

`config.systemPromptDir = ''` disables prompt-directory loading, so the default
`./prompts/` directory is never read.

## How the scripted service works

- `createStream()` returns the next scripted round and increments
  `roundsPlayed()`. The first round requests `lookup_order`; the second returns
  the final text.
- The service under test is a real `ChatService` subclass, so the tool loop,
  message history, hooks and stream accumulation all run normally.
- The same pattern tests hooks, error paths, usage and interruption by changing
  the events.

## See also

- [Adding a new provider](../services/custom-provider.md)
- [ChatService tool-call loop](../services/chat-service.md#tool-call-loop)
- [Stream summaries](../services/stream-hooks.md#summaries)
