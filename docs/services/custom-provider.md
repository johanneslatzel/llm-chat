# Adding a new provider

Extend `ChatService` and implement `createStream()`:

```ts
class AnthropicChatService extends ChatService {
    protected async *createStream(): AsyncIterable<StreamEvent> {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            body: JSON.stringify({ /* ... */ })
        });
        for await (const event of parseSSE(response)) {
            yield event; // StreamEvent values
        }
    }
}
```
