# Hooks

Hooks let you react to events in the chat and tool lifecycle.

- **[Stream hooks](services/stream-hooks.md)** — observe streaming output (content, reasoning, tool-call deltas, finish) via `service.stream().hook().chunks().do(cb)`
- **[Chat hooks](chats/chat-hooks.md)** — subscribe to messages by role/regex
- **[Tool hooks](tools/tool-hooks.md)** — before, after, and error hooks on tool execution
