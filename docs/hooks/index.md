# Hooks

Hooks react to events in the chat and tool lifecycle.

## Navigation

- [Service hooks](../services/chat-service.md#service-hooks): observe and control the send loop lifecycle via `service.hook().beforeSendLoop().do(cb)`
- [Stream hooks](../services/stream-hooks.md): observe streaming output (content, reasoning, tool-call deltas, usage, finish) via `service.stream().hook().chunks().do(cb)`
- [Chat hooks](../chats/chat-hooks.md): subscribe to messages by role/regex
- [Tool hooks](https://johanneslatzel.github.io/llm-chat-tool/tools/tool-hooks/): before, after, and error hooks on tool execution
- [JSON hooks](json-hooks.md): declare hooks as `.json` files in a configurable directory, auto-loaded on init/send
- [HookMessageWriter](hook-message-writer.md): how hooks queue messages with `origin: Hook`

## Framework types

Two base types support the hook builders:

- **`HookBuilderBase<TCallback>`**: abstract base for the filter and message hook builders. Declares the abstract `.do(cb)` contract: implementations register the hook and return a `Hook` for disposal. The entry builders `ChatHookBuilder`, `ToolHookBuilder`, `StreamHookBuilder`, and `ServiceHookBuilder` do not extend it.
- **`HasHooks<THookBuilder>`**: interface for any class that exposes a `.hook()` method returning a builder. Implemented by `ChatInterface`, `ChunkStreamInterface`, `ToolSuiteInterface`, and `ChatService`.

`HookBuilderBase` and `HasHooks` come from `@johannes.latzel/llm-chat-tool`; this package does not re-export them. `ToolHookBuilder` is also from that package. `ServiceHookBuilder` is also part of this package and is returned by `service.hook()`.

## Example pages

- [Hooks](../examples/hooks.md)
- [JSON hooks](../examples/json-hooks.md)
