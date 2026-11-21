<a id="readme-top"></a>

<h1 align="center">@johannes.latzel/llm-chat</h1>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![NPM](https://nodei.co/npm/@johannes.latzel/llm-chat.svg?style=shields&data=n,v,u,d,s)](https://www.npmjs.com/package/@johannes.latzel/llm-chat)
[![version](https://img.shields.io/github/package-json/v/johanneslatzel/llm-chat)](https://github.com/johanneslatzel/llm-chat/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/node/v/@johannes.latzel/llm-chat.svg)](https://www.npmjs.com/package/@johannes.latzel/llm-chat)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat/pulls)
[![Feedback Welcome](https://img.shields.io/badge/feedback-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat/discussions)
[![codecov](https://codecov.io/gh/johanneslatzel/llm-chat/graph/badge.svg)](https://codecov.io/gh/johanneslatzel/llm-chat)
[![CI](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml)
[![Socket Badge](https://badge.socket.dev/npm/package/@johannes.latzel/llm-chat/latest)](https://socket.dev/npm/package/@johannes.latzel/llm-chat)
[![AI Assisted Yes](https://img.shields.io/badge/AI%20Assisted-Yes-green)](https://github.com/mefengl/made-by-ai)

<p align="center">
Provider-neutral TypeScript LLM chat engine with typed tool calls, streaming, and hooks
</p>

<p align="center">
<a href="https://www.npmjs.com/package/@johannes.latzel/llm-chat">npm</a>
&middot;
<a href="https://github.com/johanneslatzel/llm-chat">GitHub</a>
&middot;
<a href="https://johanneslatzel.github.io/llm-chat/">Docs</a>
&middot;
<a href="#quick-start">Quick start</a>
&middot;
<a href="https://johanneslatzel.github.io/llm-chat/examples/">Examples</a>
&middot;
<a href="https://github.com/johanneslatzel/llm-chat/issues">Issues</a>
&middot;
<a href="https://github.com/johanneslatzel/llm-chat/releases">Releases</a>
</p>

<details>
<summary>Table of Contents</summary>

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Packages](#packages)
- [Related packages](#related-packages)
- [Installation](#installation)
- [Quick start](#quick-start)
    - [Connect a provider](#connect-a-provider)
    - [Stream a reply](#stream-a-reply)
    - [Loop a conversation](#loop-a-conversation)
- [System prompts](#system-prompts)
    - [Flat string](#flat-string)
    - [File](#file)
    - [Prompt tree](#prompt-tree)
- [Add a tool](#add-a-tool)
- [Hooks](#hooks)
- [Why llm-chat](#why-llm-chat)
- [Providers](#providers)
- [When to use llm-chat](#when-to-use-llm-chat)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Documentation](#documentation)
    - [Core concepts](#core-concepts)
    - [Guides](#guides)
- [Development](#development)
- [Security](#security)
- [Maintainer](#maintainer)
- [License](#license)
- [Contributing](#contributing)
- [Ecosystem](#ecosystem)

</details>

## Features

- typed tool calls with validated parameters and structured results
- streaming with typed chunk hooks
- message, tool, stream, and service hooks
- prompt trees built from flat strings, files, or directories
- a provider-neutral `ChatService` contract with normalized stream events
- structured output via JSON mode and JSON Schema
- session persistence and interrupt/resume
- four runtime dependencies: `@johannes.latzel/llm-chat-message`, `@johannes.latzel/llm-chat-tool`, `@johannes.latzel/env`, and `async-mutex`

Structured output requests JSON from the provider and parses it. The engine
surfaces `StructuredOutputError` when the answer is missing, refused,
filtered, incomplete, or not valid JSON. It does not schema-validate, repair,
or retry; use a validator in the caller when the schema has to hold.

## Prerequisites

| Requirement | Value |
|---|---|
| Node.js | >= 22 |
| Module format | ESM-only (no CommonJS build) |
| Provider | Required to send to a hosted model; optional for engine-only use. Use `@johannes.latzel/llm-chat-openai` or implement `ChatService.createStream()` |
| TypeScript | Optional; `.d.ts` files included |

## Packages

The ecosystem is split into four packages: `@johannes.latzel/llm-chat` (the
abstract engine), `@johannes.latzel/llm-chat-message` (message vocabulary),
`@johannes.latzel/llm-chat-tool` (tool primitives), and
`@johannes.latzel/llm-chat-openai` (the OpenAI provider).

Nothing is re-exported through `@johannes.latzel/llm-chat`; import each
primitive from its owning package. The public API types are
`ChatInterface`, `ChunkStreamInterface`, and `ToolSuiteInterface`; their
implementing classes are internal. `ChatRole`, `ChatMessageOrigin`,
`ChatMessage`, `ToolCall`, `MessageWriter` and related types belong to
`@johannes.latzel/llm-chat-message`.

The engine has no provider dependency and no vendor SDK.

## Related packages

| Package | Description |
|---|---|
| [`@johannes.latzel/llm-chat-message`](https://johanneslatzel.github.io/llm-chat-message/) | Provider-neutral message, role, finish-reason and writer primitives; zero runtime dependencies |
| [`@johannes.latzel/llm-chat-tool`](https://johanneslatzel.github.io/llm-chat-tool/) | Provider-neutral tool, hook and result primitives; zero runtime dependencies |
| [`@johannes.latzel/llm-chat-openai`](https://johanneslatzel.github.io/llm-chat-openai/) | OpenAI / OpenAI-compatible provider implementing `ChatService.createStream()` |

## Installation

```bash
# engine
npm install @johannes.latzel/llm-chat

# optional: OpenAI / OpenAI-compatible provider
npm install @johannes.latzel/llm-chat-openai

# message primitives when importing message types directly
npm install @johannes.latzel/llm-chat-message

# tool primitives when defining tools
npm install @johannes.latzel/llm-chat-tool
```

A provider is optional for engine-only use and required to send to a hosted
model: use `@johannes.latzel/llm-chat-openai`, or implement
`ChatService.createStream()` in a subclass. See
[Adding a new provider](https://johanneslatzel.github.io/llm-chat/services/custom-provider/).

## Quick start

### Connect a provider

`ChatService` is abstract, and the engine ships no provider. Use
`@johannes.latzel/llm-chat-openai`, or write a provider subclass that
implements `createStream(signal?)` and yields `StreamEvent` values; the engine
handles the tool loop, streaming state and hooks. See
[Adding a new provider](https://johanneslatzel.github.io/llm-chat/services/custom-provider/)
for a complete skeleton.

The engine reads only `LLM_CHAT_*` variables. The OpenAI provider adds
`OPENAI_API_KEY`, optional `OPENAI_BASE_URL`, and
`LLM_CHAT_OPENAI_DEFAULT_MODEL`; see the
[provider environment variables](https://johanneslatzel.github.io/llm-chat-openai/env/)
and the [provider quick start](https://johanneslatzel.github.io/llm-chat-openai/quickstart/)
for a setup with `OPENAI_API_KEY`.

The snippets below use `ChatService` so they stay provider-neutral.

```typescript
import type { ChatService } from "@johannes.latzel/llm-chat";

// Supply a concrete ChatService from a provider package,
// or subclass ChatService yourself.
declare const service: ChatService;
```

### Stream a reply

```typescript
import { ChunkType, type ChatService } from "@johannes.latzel/llm-chat";

declare const service: ChatService;

service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

await service.chat().user("What can you do?");
await service.send();

await service.chat().user("Great.");
await service.chat().user("What now?");
await service.send();
```

[Back to top](#readme-top)

### Loop a conversation

A loop is useful when the next turn depends on more than the last message.
A `run_tests` tool that runs the test command can set a flag from its hook:

```typescript
let testsPassed = false;

service.tools()
    .hook()
    .filter("run_tests")
    .before()
    .do(() => {
        testsPassed = false;
    });

service.tools()
    .hook()
    .filter("run_tests")
    .after()
    .do(() => {
        // only successful tool calls reach this
        testsPassed = true;
    });
```

Then drive the loop manually:

```typescript
await service.chat().user("Refactor the project until the tests pass.");

while (!testsPassed) {
    await service.send();

    if (!testsPassed) {
        await service.chat().user("The tests are still failing. Continue.");
    }
}
```

Or let `afterSend()` drive the next round:

```typescript
service.hook()
    .afterSend()
    .do(async () => {
        if (testsPassed) return;

        service.queue().user("The tests are still failing. Continue.");
        service.setNeedsResend();
    });

await service.chat().user("Refactor the project until the tests pass.");
await service.send();
```

File-based conditions work the same way: set a flag when a `write_file` or
`edit_file` tool succeeds, or compare the working tree before and after each
`send()`. Add a round cap in production to keep the loop bounded.

[Back to top](#readme-top)

## System prompts

When several system prompt sources are configured at once, flat strings win
over files, which win over prompt trees.

### Flat string

```typescript
import { ChatServiceConfiguration } from "@johannes.latzel/llm-chat";

const config = new ChatServiceConfiguration();
config.systemPrompt = "You are a concise assistant.";
```

Set `LLM_CHAT_SYSTEM_PROMPT` to use it via env.

### File

```typescript
import { ChatServiceConfiguration } from "@johannes.latzel/llm-chat";

const config = new ChatServiceConfiguration();
config.systemPromptFile = "AGENTS.md";
```

Set `LLM_CHAT_SYSTEM_PROMPT_FILE` to use it via env.

### Prompt tree

See the [system prompt tree](https://johanneslatzel.github.io/llm-chat/chats/building-messages/#system-prompt) diagram in the docs.

Build the prompt tree programmatically:

```typescript
import type { ChatService } from "@johannes.latzel/llm-chat";

declare const service: ChatService;

const general = service.chat().system().child("general");

general.prompt("persona").setContent("You are a concise assistant.");
general.prompt("rules").setContent("Answer in one paragraph.");
general.prompt("context").setContent("You are helping with TypeScript.");
```

Or load a directory of `.md`/`.txt` files as prompt components:

```typescript
import { ChatServiceConfiguration } from "@johannes.latzel/llm-chat";

const config = new ChatServiceConfiguration();
config.systemPromptDir = "./prompts";
```

Set `LLM_CHAT_SYSTEM_PROMPT_DIR` to use the directory via env. Pass the config
to the provider's `ChatService` constructor.

[Back to top](#readme-top)

## Add a tool

Extend `Tool`, describe the parameters, and register it. The service runs the
tool-call loop. Tool errors are returned to the model instead of crashing the loop.

The weather tool calls [wttr.in](https://wttr.in/), which returns the current
condition as plain text. No API key is required.

```typescript
import {
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult,
} from "@johannes.latzel/llm-chat-tool";
import type { ChatService } from "@johannes.latzel/llm-chat";

declare const service: ChatService;

class WeatherTool extends Tool {
    constructor() {
        super(
            "get_weather",
            "Get the current weather for a city.",
            new ToolParameters(
                { city: ToolParameterProperty.string("City name") },
                ["city"]
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        const city = args.city;
        if (typeof city !== "string") {
            return { result: "city must be a string", status: ResultStatus.Error };
        }

        const response = await fetch(
            `https://wttr.in/${encodeURIComponent(city)}?format=%C+%t`
        );
        if (!response.ok) {
            return {
                result: `Weather request failed: ${response.status}`,
                status: ResultStatus.Error
            };
        }

        const weather = (await response.text()).replace(/\s+/g, " ").trim();
        return { result: `${weather} in ${city}`, status: ResultStatus.Success };
    }
}

service.tools().add(new WeatherTool());
await service.chat().user("What is the weather in Berlin?");
await service.send();
```

[Back to top](#readme-top)

## Hooks

Hooks observe and steer the conversation without changing the core flow. Each
hook returns a `Hook`; call `.dispose()` to unsubscribe.

| Hook | Access | Fires on |
|---|---|---|
| Stream | `service.stream().hook()` | content, reasoning, tool-call, usage, and finish chunks |
| Chat | `service.chat().hook()` | messages filtered by role and/or regex |
| Tool | `service.tools().hook()` | before, after, and error tool events |
| Service | `service.hook()` | send-loop lifecycle |
| JSON | `LLM_CHAT_HOOKS_DIR` | declarative `.json` hook files |

```typescript
import { ChunkType } from "@johannes.latzel/llm-chat";
import { ChatRole } from "@johannes.latzel/llm-chat-message";

// before a tool runs
service.tools().hook().before().do((name, args) => {
    console.log(name, args);
});

// assistant messages only
service.chat().hook().message(ChatRole.Assistant).do((message) => {
    console.log(message.content);
});

// stop after the first finish chunk
const hook = service.stream().hook().chunks(ChunkType.Finish).do((chunk) => {
    console.log(chunk.finishReason);
    hook.dispose();
});
```

[Back to top](#readme-top)

## Why llm-chat

A provider subclass handles transport and request mapping. `llm-chat` adds the
conversation loop around it. See the [architecture overview](https://johanneslatzel.github.io/llm-chat/architecture/#overview) for the
full figure.

- **Typed tool schemas** with nested objects, arrays, hidden aliases, and
  required-parameter validation.
- **Automatic tool execution** with a configurable recursion limit and safe
  error results.
- **Normalized streaming** into content, reasoning, tool-call, usage, and
  finish chunks across providers.
- **Hooks at every layer**: stream chunks, completed messages, tool lifecycle,
  service lifecycle, and JSON-defined hooks.
- **Conversation state** that can be serialized, restored, queued, compacted,
  and passed between sessions.
- **Composable system prompts** with a prompt tree and reusable components.
- **Provider-neutral by design**: one `ChatService` contract for any backend.
- **Small runtime surface**: `@johannes.latzel/llm-chat-message`,
  `@johannes.latzel/llm-chat-tool`, `@johannes.latzel/env`, and `async-mutex`.

Optional extras include inline reasoning and tool-call parsing, token
estimation, context-window handoff, and tool packages with tutorial prompts.

[Back to top](#readme-top)

## Providers

The engine ships no provider. Use `@johannes.latzel/llm-chat-openai`, or
implement a provider subclass: `createStream(signal?)` yields normalized
`StreamEvent` values:

- content
- reasoning
- refusal
- tool-call deltas
- usage
- finish

The base class accumulates events, assembles tool calls, runs registered tools,
and records the conversation. See
[Adding a new provider](https://johanneslatzel.github.io/llm-chat/services/custom-provider/)
for the contract and a skeleton implementation.

[Back to top](#readme-top)

## When to use llm-chat

Use llm-chat for a typed chat loop, streaming, and tool execution without
adopting an agent framework.

- Use a **raw vendor SDK** for single requests or transport only.
- Use **Vercel AI SDK** for multi-provider model access, structured output,
  or streaming UI hooks across React, Next.js, Vue, Svelte, or Angular.
- Use **LangChain** for an agent framework with broad integrations, RAG and
  vector-store abstractions, or LangGraph for stateful orchestration.

[Back to top](#readme-top)

## Troubleshooting

### No provider configured

`ChatService` is abstract and the engine ships no provider. Use
`@johannes.latzel/llm-chat-openai`, or subclass `ChatService` and implement
`createStream()`. See [Adding a new provider](https://johanneslatzel.github.io/llm-chat/services/custom-provider/).

### Model selection

Model names and credentials are provider-specific. Configure them in the
provider subclass; the engine does not read vendor environment variables.

### System prompt file not found

`systemPromptFile` is resolved from `process.cwd()`. The file must exist when
`init()` or the first `send()` runs, otherwise loading throws.

### Unexpected message filtering

Provider subclasses can override `shouldSendMessage()`. If stored messages do
not reach the backend, check that override.

[Back to top](#readme-top)

## Support

- Bugs and feature requests: [GitHub Issues](https://github.com/johanneslatzel/llm-chat/issues)
- Questions and discussion: [GitHub Discussions](https://github.com/johanneslatzel/llm-chat/discussions)

[Back to top](#readme-top)

## Documentation

### Core concepts

| Concept | What it does | Docs |
|---|---|---|
| `Chat` | Message history, roles, system prompt tree, serialization | [Chats](https://johanneslatzel.github.io/llm-chat/chats/) |
| `ChatService` | Send loop, tool execution, queueing, context handoff | [ChatService](https://johanneslatzel.github.io/llm-chat/services/chat-service/) |
| `Tool` | Typed parameter schema and execution boundary | [Defining tools](https://johanneslatzel.github.io/llm-chat-tool/tools/defining-tools/) |
| `ChunkStream` | Streaming chunks, summaries, and usage | [Stream hooks](https://johanneslatzel.github.io/llm-chat/services/stream-hooks/) |
| Hooks | Stream, message, tool, service, and JSON hooks | [Hooks](https://johanneslatzel.github.io/llm-chat/hooks/) |
| `ChatServiceConfiguration` | Tool rounds, prompts, inline parsing, context hint | [ChatService](https://johanneslatzel.github.io/llm-chat/services/chat-service/#configuration) |

### Guides

- [Examples](https://johanneslatzel.github.io/llm-chat/examples/)
- [Quick start](https://johanneslatzel.github.io/llm-chat/examples/quick-start/)
- [Typed tools](https://johanneslatzel.github.io/llm-chat-tool/examples/typed-tools/)
- [Tool packages](https://johanneslatzel.github.io/llm-chat-tool/examples/tool-packages/)
- [Timed tools](https://johanneslatzel.github.io/llm-chat-tool/examples/timed-tools/)
- [Service hooks](https://johanneslatzel.github.io/llm-chat/examples/service-hooks/)
- [Tool calling](https://johanneslatzel.github.io/llm-chat/examples/tool-calling/)
- [Adding a new provider](https://johanneslatzel.github.io/llm-chat/services/custom-provider/)
- [Agent loop](https://johanneslatzel.github.io/llm-chat/examples/agent-loop/)
- [Context management](https://johanneslatzel.github.io/llm-chat/examples/context-management/)
- [Testing](https://johanneslatzel.github.io/llm-chat/examples/testing/)
- [Building messages](https://johanneslatzel.github.io/llm-chat/chats/building-messages/)
- [Defining tools](https://johanneslatzel.github.io/llm-chat-tool/tools/defining-tools/)
- [Tool packages](https://johanneslatzel.github.io/llm-chat-tool/tools/packages/)
- [Stream hooks](https://johanneslatzel.github.io/llm-chat/services/stream-hooks/)
- [Chat hooks](https://johanneslatzel.github.io/llm-chat/chats/chat-hooks/)
- [Serialization](https://johanneslatzel.github.io/llm-chat/chats/serialization/)
- [Environment variables](https://johanneslatzel.github.io/llm-chat/env/)
- [Architecture](https://johanneslatzel.github.io/llm-chat/architecture/)
- [API reference](https://johanneslatzel.github.io/llm-chat/api-reference/)

Full documentation: **[johanneslatzel.github.io/llm-chat](https://johanneslatzel.github.io/llm-chat/)**

[Back to top](#readme-top)

## Development

```bash
git clone https://github.com/johanneslatzel/llm-chat.git
cd llm-chat
npm install
npm run verify
```

`npm run verify` runs the type check, lint, file-size checks, documentation
checks, and the test suite with coverage.

[Back to top](#readme-top)

## Security

Report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/johanneslatzel/llm-chat/security/advisories/new).
Do not open a public issue for a security problem.

## Maintainer

Johannes B. Latzel ([@johanneslatzel](https://github.com/johanneslatzel)).

## License

MIT © Johannes B. Latzel. See
[LICENSE](https://github.com/johanneslatzel/llm-chat/blob/main/LICENSE).

## Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a feature branch.
2. Run `npm install`.
3. Make the change and add tests.
4. Run `npm run verify`.
5. Open a pull request.

Use conventional commit messages.

## Ecosystem

### Packages

| Project | Docs | npm | Description |
|---------|------|-----|-------------|
| [llm-chat](https://github.com/johanneslatzel/llm-chat) | [docs](https://johanneslatzel.github.io/llm-chat/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat) | abstract chat engine, streaming, hooks and tool loop |
| [llm-chat-message](https://github.com/johanneslatzel/llm-chat-message) | [docs](https://johanneslatzel.github.io/llm-chat-message/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-message) | message, role, finish-reason and writer primitives |
| [llm-chat-tool](https://github.com/johanneslatzel/llm-chat-tool) | [docs](https://johanneslatzel.github.io/llm-chat-tool/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-tool) | tool, result and hook primitives |
| [llm-chat-openai](https://github.com/johanneslatzel/llm-chat-openai) | [docs](https://johanneslatzel.github.io/llm-chat-openai/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-openai) | OpenAI and OpenAI-compatible provider |
| [env](https://github.com/johanneslatzel/env) | [docs](https://johanneslatzel.github.io/env/) | [npm](https://www.npmjs.com/package/@johannes.latzel/env) | typed environment variable readers |

### Integration

| Project | Docs | npm | Description |
|---------|------|-----|-------------|
| [llm-chat-mcp](https://github.com/johanneslatzel/llm-chat-mcp) | [docs](https://johanneslatzel.github.io/llm-chat-mcp/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-mcp) | MCP server (stdio/HTTP) serving documents and tools |

### Tools

| Project | Docs | npm | Description |
|---------|------|-----|-------------|
| [llm-chat-file](https://github.com/johanneslatzel/llm-chat-file) | [docs](https://johanneslatzel.github.io/llm-chat-file/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-file) | read/write files and folders |
| [llm-chat-memory](https://github.com/johanneslatzel/llm-chat-memory) | [docs](https://johanneslatzel.github.io/llm-chat-memory/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-memory) | active and passive memory recall |
| [llm-chat-seq](https://github.com/johanneslatzel/llm-chat-seq) | [docs](https://johanneslatzel.github.io/llm-chat-seq/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-seq) | query a Seq server |
| [llm-chat-shell](https://github.com/johanneslatzel/llm-chat-shell) | [docs](https://johanneslatzel.github.io/llm-chat-shell/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-shell) | tightly controlled shell tool |
| [llm-chat-skill](https://github.com/johanneslatzel/llm-chat-skill) | [docs](https://johanneslatzel.github.io/llm-chat-skill/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-skill) | load and manage skills |
| [llm-chat-task](https://github.com/johanneslatzel/llm-chat-task) | [docs](https://johanneslatzel.github.io/llm-chat-task/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-task) | manage a task graph |
| [llm-chat-time](https://github.com/johanneslatzel/llm-chat-time) | [docs](https://johanneslatzel.github.io/llm-chat-time/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-time) | datetime, stopwatch, and timers |
| [llm-chat-web](https://github.com/johanneslatzel/llm-chat-web) | [docs](https://johanneslatzel.github.io/llm-chat-web/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-web) | search and fetch the web |
| [llm-chat-workspace](https://github.com/johanneslatzel/llm-chat-workspace) | [docs](https://johanneslatzel.github.io/llm-chat-workspace/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-workspace) | base tools for workspace management |
| [llm-chat-drawio](https://github.com/johanneslatzel/llm-chat-drawio) | [docs](https://johanneslatzel.github.io/llm-chat-drawio/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-drawio) | draw.io diagram tools |

[Back to top](#readme-top)
