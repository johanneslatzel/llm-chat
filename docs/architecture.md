# Architecture

## Overview

The library is built around four core concepts: **Chats**, **Services**, **Tools**, and **Hooks**.

```
ChatService
 ├── Chat (ChatInterface) — message history, hooks
 ├── ToolSuite (ToolSuiteInterface) — tool registration and dispatch
 └── send() — tool-call loop

Hooks
 ├── Chat hooks (via chat.hook()) — observe stream, subscribe to messages
 └── Tool hooks (via service.tools()) — before, after, error
```

- **Chat / ChatInterface** — the public handle for building message histories and subscribing to events. Created by `service.chat()`.
- **ChatService** — abstract base class that manages the tool-call loop. It owns the `Chat` and tool registry. Call `service.send()` to start the request/response cycle.
- **Tool** — abstract base class users extend to define custom tools.
- **ToolSuiteInterface** — exposed via `service.tools()`, lets you add tools and attach before/after/error hooks.
- **Hooks** — two kinds: chat hooks (`chat.hook()`) for stream/message observation, and tool hooks (`service.tools().before/after/error()`) for tool lifecycle events.

Providers (like `OpenAIChatService`) extend `ChatService` and implement `createStream()` to connect to a specific API.
