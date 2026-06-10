# Tools

Tools let the LLM call your code. Extend `Tool` and register it via `service.tools().add(...)`.

Concrete tool implementations live in separate packages:
- [`llm-chat-filesystem`](https://github.com/johanneslatzel/llm-chat-filesystem) — filesystem, notebooks, web fetch/search, datetime, skills

- **[Defining a tool](defining-tools.md)**
- **[Registration](registration.md)**
- **[Tool hooks](tool-hooks.md)**
- **[Packages](packages.md)**
