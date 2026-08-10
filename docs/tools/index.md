# Tools

Tools let the LLM call your code. Extend `Tool` and register it via `service.tools().add(...)`.

Concrete tool implementations live in separate packages:
- [`llm-chat-file`](https://github.com/johanneslatzel/llm-chat-file) — filesystem tools
- `llm-chat-workspace` — workspace and path-access management
- [`llm-chat-memory`](https://github.com/johanneslatzel/llm-chat-memory) — memory with embeddings, links, and PageRank scoring
- `llm-chat-shell` — shell tool with a permission system
- [`llm-chat-time`](https://github.com/johanneslatzel/llm-chat-time) — date/time, stopwatch, and timer tools
- [`llm-chat-web`](https://github.com/johanneslatzel/llm-chat-web) — web search and fetch tools
- [`llm-chat-skill`](https://github.com/johanneslatzel/llm-chat-skill) — skill loading tools

The [`llm-chat-mcp`](https://github.com/johanneslatzel/llm-chat-mcp) package exposes these tools over the Model Context Protocol.

- **[Defining a tool](defining-tools.md)**
- **[Registration](registration.md)**
- **[Tool hooks](tool-hooks.md)**
- **[Packages](packages.md)**
