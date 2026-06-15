# Architecture

## Overview

The library is built around **Chats**, **Services**, **Tools**, and **Hooks**.

```
ChatService
 ├── Chat (ChatInterface) — message history, hooks
 ├── ChunkStream (ChunkStreamInterface) — raw streaming chunks
 ├── ToolSuite (ToolSuiteInterface) — tool registration and dispatch
 └── send() — tool-call loop

Hooks
 ├── Stream hooks (via service.stream().hook()) — observe raw chunks
 ├── Chat hooks (via chat.hook()) — subscribe to messages
 ├── Tool hooks (via service.tools().hook()) — before, after, error
 └── JSON hooks — declarative hooks from `.json` files, auto-loaded at startup
```

- **Chat / ChatInterface** — the public handle for building message histories and subscribing to chat events. Created by `service.chat()`.
- **ChunkStream / ChunkStreamInterface** — accumulates raw streaming chunks (content, reasoning, tool-call deltas, finish) during `send()`. Accessed via `service.stream()`.
- **ChatService** — abstract base class that manages the tool-call loop. It owns the `Chat`, `ChunkStream`, and tool registry. Call `service.send()` to start the request/response cycle.
- **Tool** — abstract base class users extend to define custom tools.
- **ToolSuiteInterface** — exposed via `service.tools()`, lets you add tools and attach hooks via `.hook().before/after/error().do()`.
- **Hooks** — four kinds: stream hooks (`service.stream().hook().chunks().do()`) for raw chunk observation, chat hooks (`chat.hook().message().do()`) for completed message observation, tool hooks (`service.tools().hook().before/after/error().do()`) for tool lifecycle events, and JSON hooks — declarative hooks defined in `.json` files that are auto-loaded at startup.

Providers (like `OpenAIChatService`) extend `ChatService` and implement `createStream()` to connect to a specific API.
