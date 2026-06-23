# Hooks

Hooks let you react to events in the chat and tool lifecycle.

- **[Service hooks](../services/chat-service.md#service-hooks)** — observe and control the send loop lifecycle via `service.hook().beforeSendLoop().do(cb)`
- **[Stream hooks](../services/stream-hooks.md)** — observe streaming output (content, reasoning, tool-call deltas, finish) via `service.stream().hook().chunks().do(cb)`
- **[Chat hooks](../chats/chat-hooks.md)** — subscribe to messages by role/regex
- **[Tool hooks](../tools/tool-hooks.md)** — before, after, and error hooks on tool execution
- **[JSON hooks](json-hooks.md)** — declare hooks as `.json` files in a configurable directory, auto-loaded at startup
- **[HookMessageWriter](hook-message-writer.md)** — how hooks queue messages with `origin: Hook`

## Framework types

Two base types underpin all hook builders:

- **`HookBuilderBase<TCallback>`** — abstract class that every hook builder extends. Provides `.do(cb)` which registers the hook and returns a `Hook` for disposal.
- **`HasHooks<THookBuilder>`** — interface for any class that exposes a `.hook()` method returning a builder. Implemented by `ChatInterface`, `ChunkStreamInterface`, `ToolSuiteInterface`, and `ChatService`.

Users rarely work with these directly; they are exported for type annotations when wrapping or composing hook builders.
