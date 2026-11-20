# Testing

`builder.withClient()` accepts a preconfigured client, which makes the whole
tool loop testable without a network or an API key.

This example runs one tool-call round and one final answer against a fake
client. It uses `node:assert` so the script runs without a test framework.

```typescript
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import {
    ChatRole,
    OpenAIChatService,
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult
} from '@johannes.latzel/llm-chat';

function chunk(delta: Record<string, unknown>, finishReason: string | null = null) {
    return {
        choices: [{ index: 0, delta, finish_reason: finishReason }],
        usage: null
    };
}

async function* stream(chunks: unknown[]): AsyncIterable<unknown> {
    for (const value of chunks) yield value;
}

function fakeClient(rounds: unknown[][]) {
    let calls = 0;
    const client = {
        chat: {
            completions: {
                create: async () => stream(rounds[calls++] ?? [])
            }
        }
    } as unknown as OpenAI;

    return { client, calls: () => calls };
}

class LookupOrderTool extends Tool {
    constructor() {
        super(
            'lookup_order',
            'Look up an order by ID.',
            new ToolParameters(
                { id: ToolParameterProperty.string('Order ID') },
                ['id']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return typeof args.id === 'string'
            ? { result: `Order ${args.id}: shipped`, status: ResultStatus.Success }
            : { result: 'id must be a string', status: ResultStatus.Error };
    }
}

const fake = fakeClient([
    [
        chunk({
            tool_calls: [
                {
                    index: 0,
                    id: 'call_1',
                    function: { name: 'lookup_order', arguments: '{"id":"42"}' }
                }
            ]
        }),
        chunk({}, 'tool_calls')
    ],
    [chunk({ content: 'Order 42 is shipped.' }), chunk({}, 'stop')]
]);

const service = OpenAIChatService.builder()
    .model('test-model')
    .withClient(fake.client)
    .systemPrompt('Use tools when they provide data.')
    .create();

service.tools().add(new LookupOrderTool());

await service.chat().user('Where is order 42?');
await service.send();

const messages = service.chat().messages();

assert.equal(fake.calls(), 2);
assert.ok(
    messages.some(
        (message) =>
            message.role === ChatRole.Tool &&
            message.content === 'Order 42: shipped'
    )
);
assert.equal(messages.at(-1)?.content, 'Order 42 is shipped.');

console.log('Tool loop completed without a network request.');
```

## How the fake works

- The fake implements the only method the service calls:
  `chat.completions.create`.
- Each array in `rounds` is the stream for one provider round. The first round
  requests `lookup_order`; the second returns the final text.

The same pattern tests hooks, error paths, and usage by changing the chunks.

## See also

- [OpenAIChatService builder](../services/openai.md#builder)
- [ChatService tool-call loop](../services/chat-service.md#tool-call-loop)
- [Stream summaries](../services/stream-hooks.md#summaries)
