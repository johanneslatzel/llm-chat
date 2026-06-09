# ChatService

`ChatService` handles the tool-call loop. It owns the chat instance and tool registry. Tools are registered via `service.tools().add(...)`:

```ts
const config = new ChatServiceConfiguration();
config.maxToolCallRounds = 25;
config.systemPromptPath = "./prompt.md";
config.userPromptPaths = ["./context.md"];

const service = new OpenAIChatService(api, openAIConfig, config);
const chat = service.chat();
// ... setup messages ...
await service.send();
```

The base class accumulates stream events, assembles tool calls, recurses on tool responses, and errors safely.

## Message queue

`service.queue()` returns a `MessageWriter` that stages messages for the next `send()` call without blocking the send mutex. This is useful when you need to enqueue messages from a concurrent context (timer, interrupt handler, etc.) without waiting for an in-flight request to finish.

```ts
await service.queue().user('Timer "build" (30s) has expired.');
await service.send(); // drains the queue into chat before sending
```

The queue uses its own mutex, so enqueuing is fast and independent of the send and chat mutexes.

## Streaming

Stream hooks are documented in [Stream hooks](stream-hooks.md).
