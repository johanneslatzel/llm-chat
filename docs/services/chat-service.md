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

## Streaming

Stream hooks are documented in [Stream hooks](stream-hooks.md).
