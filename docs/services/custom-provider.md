# Adding a new provider

`ChatService` is abstract. For a first-party implementation, see
[`@johannes.latzel/llm-chat-openai`](https://johanneslatzel.github.io/llm-chat-openai/).
Subclass `ChatService` and implement `createStream(signal?)`, yielding
`StreamEvent` values that the base class turns into chat history, tool-call
rounds, and stream chunks:

```typescript
import {
    ChatService,
    StreamEventType,
    type ChatServiceConfiguration,
    type StreamEvent,
} from "@johannes.latzel/llm-chat";
import { FinishReason } from "@johannes.latzel/llm-chat-message";

// Provider code: split the response body into the backend's events.
declare function readEvents(response: Response): AsyncIterable<unknown>;

class MyChatService extends ChatService {
    constructor(config?: ChatServiceConfiguration) {
        super(config);
    }

    protected async *createStream(signal?: AbortSignal): AsyncIterable<StreamEvent> {
        const response = await fetch("https://your-endpoint.example/v1/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                messages: this.chat().messages(),
                // Add the tool definitions the backend expects.
            }),
            signal,
        });

        for await (const payload of readEvents(response)) {
            const event = payload as { text?: string; done?: boolean };

            if (typeof event.text === "string") {
                yield { type: StreamEventType.Content, text: event.text };
            }

            if (event.done) {
                yield { type: StreamEventType.Finish, reason: FinishReason.Stop };
            }
        }
    }
}
```

`this.chat().messages()` returns the stored messages in the engine's neutral
shape; mapping them, and the tool definitions below, to the backend's wire
format is the provider's job.

`readEvents` is provider code; the library ships no transport or parser. The sample also hardcodes `FinishReason.Stop`; map the backend's actual
stop reasons, and emit `StreamEventType.ToolCallDelta` events when the backend
asks for tools.

## The stream contract

The engine expects the iterator to produce the normalized event variants it
understands:

| Event | Payload |
|---|---|
| `StreamEventType.Content` | `text` |
| `StreamEventType.Reasoning` | `text` |
| `StreamEventType.Refusal` | `text` |
| `StreamEventType.ToolCallDelta` | `index`, optional `id`, `name`, `arguments` |
| `StreamEventType.Usage` | `usage` |
| `StreamEventType.Finish` | `reason` |

Emit `Finish` exactly once per round. The base class handles accumulation,
tool execution, message history, hooks, cancellation and retries.

## Configuration

Pass a `ChatServiceConfiguration` to the base constructor to use the
engine-level options:

```typescript
import { ChatServiceConfiguration } from "@johannes.latzel/llm-chat";

const config = new ChatServiceConfiguration();
config.systemPrompt = "You are a concise assistant.";
config.maxToolCallRounds = 20;

const service = new MyChatService(config);
```

Model names, credentials, request options and transport settings belong to the
provider subclass, not to the engine configuration.

## Tool definitions

`Tool.definition()` returns a neutral `ToolDefinition`:

```typescript
import type { ToolDefinition } from '@johannes.latzel/llm-chat-tool';

const definition: ToolDefinition = tool.definition();
// { name, description, parameters }
```

`this.tools().getDefinitions()` returns the definitions of every registered
tool. Convert them to the request shape the backend expects:

```typescript
const definitions = this.tools().getDefinitions();
const requestTools = definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.parameters,
}));
```
