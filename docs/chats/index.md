# ChatInterface

The chat handle returned by `service.chat()` implements `ChatInterface`:

```ts
interface ChatInterface {
    user(content: string): void;
    system(content: string): void;
    assistant(content: string, tool_calls?: ToolCall[]): void;
    tool(content: string, tool_call_id: string): void;
    messages(): ChatMessage[];
    toJSON(): ChatJSON;
    hook(): HookBuilder;
}
```

This is the complete public API. Methods like `chunk()`, `reasoning()`, and `finish()` are only accessible to service implementations via the concrete `Chat` class.

- [Building messages](building-messages.md)
- [Chat hooks](chat-hooks.md)
- [Serialization](serialization.md)
