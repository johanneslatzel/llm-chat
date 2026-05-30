# LLM Chat

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![version](https://img.shields.io/github/package-json/v/johanneslatzel/llm-chat)](https://github.com/johanneslatzel/llm-chat/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat/pulls)
[![codecov](https://codecov.io/gh/johanneslatzel/llm-chat/graph/badge.svg)](https://codecov.io/gh/johanneslatzel/llm-chat)
[![CI](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml)

A typed TypeScript package for building LLM-powered chats with tool execution and hooks. Currently only OpenAI compatible agents are supported out of the box.

## Prerequisites

- Node.js >= 18
- An OpenAI-compatible API endpoint (e.g. [LM Studio](https://lmstudio.ai/))

## Installation

This package is not (yet) released on npmjs, but releases can be found on [Github](https://github.com/johanneslatzel/llm-chat/releases).

```bash
npm install johanneslatzel/llm-chat                       # latest release
```

or

```bash
npm install johanneslatzel/llm-chat#v0.1.0                # specific version
```

## Quick Start

```ts
import { OpenAIChatService } from "llm-chat";

const service = new OpenAIChatService();
const chat = service.chat();

// build the message history
chat.system("You are a helpful assistant.");
chat.user("What is the weather in Berlin?");

// send to the model and stream the response
await service.send();

// read the full conversation
for (const msg of chat.messages()) {
    console.log(msg.role, msg.content);
}
```

> Set `LLM_CHAT_OPENAI_DEFAULT_MODEL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY` as environment variables (or load them from `.env` with your own dotenv setup). See [Configuration](#configuration) below.

### With tools

```ts
import { OpenAIChatService, Tool, ToolParameters, ToolParameterProperty, ResultStatus } from "llm-chat";

class GreetTool extends Tool {
    constructor() {
        super("greet", "Greets a person by name.", new ToolParameters(
            { name: new ToolParameterProperty("The name to greet") }, ["name"]
        ));
    }
    protected async onExecute(args: Record<string, unknown>) {
        const name = args.name;
        return typeof name === "string"
            ? { result: `Hello, ${name}!`, status: ResultStatus.Success }
            : { result: "name must be a string", status: ResultStatus.Error };
    }
}

const service = new OpenAIChatService();
service.tools().add(new GreetTool());
const chat = service.chat();

chat.hook().chunk((_, text) => process.stdout.write(text));
chat.hook().reasoning((_, text) => process.stdout.write(text));
chat.hook().finish((_, reason) => console.log("\nFinished:", reason));

await service.send();
```

## Configuration

Set these environment variables (e.g. via `.env` loaded by your own dotenv setup, or directly in your shell):

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://hostname:port/v1
LLM_CHAT_OPENAI_DEFAULT_MODEL=your_model_here
```

Pass a model inline via `OpenAIChatServiceConfiguration` to override the env var:

```ts
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.model = "your-model";
openAIConfig.temperature = 0.7;

const service = new OpenAIChatService(api, openAIConfig, config);
```

See [`docs/env.md`](docs/env.md) for all available options.

## API

### ChatInterface

| Export | Description |
|--------|-------------|
| `ChatInterface` | Public chat handle — `user()`, `system()`, `assistant()`, `tool()`, `messages()`, `toJSON()`, `hook()` |
| `chatFromJSON` | Restore a serialized chat |
| `ChatRole` | Enum: `System`, `User`, `Assistant`, `Tool`, `Reasoning` |
| `FinishReason` | Enum: `Stop`, `ToolCalls`, `Length` |
| `ChatMessage` | Type for a single message |
| `ToolCall` | Type for a tool call request |
| `HookBuilder` | Builder returned by `chat.hook()` — `.chunk()`, `.reasoning()`, `.finish()`, `.message()` |
| `MessageHookBuilder` | Builder for message hooks — `.regex()`, `.maxTriggers()`, `.do()` |

### Services

| Export | Description |
|--------|-------------|
| `ChatService` | Abstract base class with tool-call loop, prompt file loading |
| `ChatServiceConfiguration` | Config: max tool-call rounds, system prompt, user prompt paths |
| `OpenAIChatService` | OpenAI-compatible streaming implementation |
| `OpenAIChatServiceConfiguration` | Config: temperature, max tokens, top-p, stop sequences |

### Tools

| Export | Description |
|--------|-------------|
| `Tool` | Abstract base class for creating tools |
| `ToolSuite` | Register and dispatch tools by name |
| `ToolSuiteInterface` | Public interface — `add()`, `before()`, `after()`, `error()` |
| `ToolParameters`, `ToolParameterProperty` | Build OpenAI-compatible tool schemas |
| `ResultStatus`, `ToolResult`, `PartialToolResult` | Tool execution result types |

### Hook

| Export | Description |
|--------|-------------|
| `Hook` | Abstract base — `dispose(): void` |

## Documentation

- [`docs/chats.md`](docs/chats.md) — ChatInterface, hooks, serialization
- [`docs/tools.md`](docs/tools.md) — Tool system, hooks
- [`docs/env.md`](docs/env.md) — Environment variables reference

## License

MIT — see [`LICENSE`](LICENSE).

## Contributing

Issues and PRs welcome at [github.com/johanneslatzel/llm-chat](https://github.com/johanneslatzel/llm-chat).
