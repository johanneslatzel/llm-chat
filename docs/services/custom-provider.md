# Adding a new provider

`ChatService` is abstract. Subclass it and implement `createStream(signal?)`, yielding `StreamEvent` values that the base class turns into chat history, tool-call rounds, and stream chunks:

```typescript
import {
    ChatService,
    FinishReason,
    StreamEventType,
    type StreamEvent
} from "@johannes.latzel/llm-chat";

// You provide this: split the response body into the provider's SSE `data` payloads.
declare function parseSSE(response: Response): AsyncIterable<unknown>;

class AnthropicChatService extends ChatService {
    constructor() {
        super();
    }

    protected async *createStream(signal?: AbortSignal): AsyncIterable<StreamEvent> {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ /* ... */ }),
            signal
        });
        for await (const payload of parseSSE(response)) {
            const event = payload as { type: string; delta?: { text?: string } };
            const text = event.type === "content_block_delta" ? event.delta?.text : undefined;
            if (text) yield { type: StreamEventType.Content, text };
        }
        yield { type: StreamEventType.Finish, reason: FinishReason.Stop };
    }
}
```

`parseSSE` is yours to implement, since the library ships no SSE parser. The sample also hardcodes `FinishReason.Stop`; map the provider's actual stop reasons and emit `StreamEventType.ToolCallDelta` events when the provider asks for tools.
