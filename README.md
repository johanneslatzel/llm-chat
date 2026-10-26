<a id="readme-top"></a>

<h1 align="center">LLM Chat <em>(@johannes.latzel/llm-chat)</em></h1>

<p align="center">
TypeScript chat agents with typed tool calls, streaming, and hooks for OpenAI-compatible APIs
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![NPM](https://nodei.co/npm/@johannes.latzel/llm-chat.svg?style=shields&data=n,v,u,d,s)](https://www.npmjs.com/package/@johannes.latzel/llm-chat)
[![version](https://img.shields.io/github/package-json/v/johanneslatzel/llm-chat)](https://github.com/johanneslatzel/llm-chat/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/node/v/@johannes.latzel/llm-chat.svg)](https://www.npmjs.com/package/@johannes.latzel/llm-chat)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat/pulls)
[![Feedback Welcome](https://img.shields.io/badge/feedback-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat/discussions)
[![codecov](https://codecov.io/gh/johanneslatzel/llm-chat/graph/badge.svg)](https://codecov.io/gh/johanneslatzel/llm-chat)
[![CI](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml)
[![Socket Badge](https://badge.socket.dev/npm/package/@johannes.latzel/llm-chat/latest)](https://badge.socket.dev/npm/package/@johannes.latzel/llm-chat/latest)
[![AI Assisted Yes](https://img.shields.io/badge/AI%20Assisted-Yes-green)](https://github.com/mefengl/made-by-ai)

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

- [Quick start](#quick-start)
    - [Requirements](#requirements)
    - [Installation](#installation)
    - [Configure](#configure)
    - [Stream a reply](#stream-a-reply)
    - [Loop a conversation](#loop-a-conversation)
- [System prompts](#system-prompts)
    - [Flat string](#flat-string)
    - [File](#file)
    - [Prompt tree](#prompt-tree)
- [Add a tool](#add-a-tool)
- [Hooks](#hooks)
- [Why llm-chat](#why-llm-chat)
- [Works with OpenAI-compatible endpoints](#works-with-openai-compatible-endpoints)
- [When to use llm-chat](#when-to-use-llm-chat)
- [Troubleshooting](#troubleshooting)
- [Support](#support)
- [Documentation](#documentation)
    - [Core concepts](#core-concepts)
    - [Guides](#guides)
- [Development](#development)
- [Security](#security)
- [Maintainer](#maintainer)
- [Contributing](#contributing)
- [Ecosystem](#ecosystem)
- [License](#license)

</details>

## Quick start

### Requirements

| Requirement | Value |
|---|---|
| Node.js | >= 22 |
| Module format | ESM-only (no CommonJS build) |
| API | OpenAI Chat Completions-compatible endpoint |
| TypeScript | Optional; `.d.ts` files included |

### Installation

```bash
npm install @johannes.latzel/llm-chat
```

### Configure

Most settings can be provided through environment variables or config objects
passed to the builder.

```bash
export OPENAI_API_KEY=your-key
export OPENAI_BASE_URL=https://api.openai.com/v1
```

### Stream a reply

Create a service, send a message, and stream the reply:

```typescript
import { OpenAIChatService, ChunkType } from "@johannes.latzel/llm-chat";

// build a service
const service = OpenAIChatService.builder()
    .model("your-model")
    .systemPrompt("You are a concise assistant.")
    .create();

// configure how to handle the responses
service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

// send a single message
service.chat().user("What can you do?");
await service.send();

// send several messages
service.chat().user("Great.");
service.chat().user("What now?");
await service.send();
```

[Back to top](#readme-top)

### Loop a conversation

A loop is useful when the next turn depends on more than the last message.
Suppose your app registers a `run_tests` tool that runs your test command. Set
a flag from its tool hook:

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
service.chat().user("Refactor the project until the tests pass.");

while (!testsPassed) {
    await service.send();

    if (!testsPassed) {
        service.chat().user("The tests are still failing. Continue.");
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

service.chat().user("Refactor the project until the tests pass.");
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
const service = OpenAIChatService.builder()
    .model("your-model")
    .systemPrompt("You are a concise assistant.")
    .create();
```

Set `LLM_CHAT_SYSTEM_PROMPT` to use it via env.

### File

```typescript
const service = OpenAIChatService.builder()
    .model("your-model")
    .systemPromptFile("AGENTS.md")
    .create();
```

Set `LLM_CHAT_SYSTEM_PROMPT_FILE` to use it via env.

### Prompt tree

![System prompt tree](https://raw.githubusercontent.com/johanneslatzel/llm-chat/main/docs/assets/llm-chat-system-prompt-tree.svg)

Build the prompt tree programmatically:

```typescript
const service = OpenAIChatService.builder().model("your-model").create();
const general = service.chat().system().child("general");

general.prompt("persona").setContent("You are a concise assistant.");
general.prompt("rules").setContent("Answer in one paragraph.");
general.prompt("context").setContent("You are helping with TypeScript.");
```

Or load a directory of `.md`/`.txt` files as prompt components:

```typescript
import { ChatServiceConfiguration, OpenAIChatService } from "@johannes.latzel/llm-chat";

const config = new ChatServiceConfiguration();
config.systemPromptDir = "./prompts";

const service = OpenAIChatService.builder()
    .model("your-model")
    .withServiceConfig(config)
    .create();
```

Set `LLM_CHAT_SYSTEM_PROMPT_DIR` to use the directory via env.

[Back to top](#readme-top)

## Add a tool

Extend `Tool`, describe the parameters, and register it. The service runs the
tool-call loop for you. Tool errors are returned to the model instead of crashing the loop.

The weather tool calls [wttr.in](https://wttr.in/), which returns the current
condition as plain text. No API key is required.

```typescript
import {
    OpenAIChatService,
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult
} from "@johannes.latzel/llm-chat";

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

const service = OpenAIChatService.builder()
    .model("your-model")
    .create();
service.tools().add(new WeatherTool());

service.chat().user("What is the weather in Berlin?");

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
import { ChatRole, ChunkType } from "@johannes.latzel/llm-chat";

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

The OpenAI SDK handles the request. llm-chat adds the conversation loop around
it:

![LLM Chat architecture](https://raw.githubusercontent.com/johanneslatzel/llm-chat/main/docs/assets/llm-chat-architecture.svg)

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
- **OpenAI-compatible by design**: one service for any endpoint implementing
  the Chat Completions API.
- **Small runtime surface**: `openai` and `async-mutex`, no agent framework.

Optional extras include inline reasoning and tool-call parsing, token
estimation, context-window handoff, and tool packages with tutorial prompts.

[Back to top](#readme-top)

## Works with OpenAI-compatible endpoints

`OpenAIChatService` calls the OpenAI Chat Completions API. Point
`OPENAI_BASE_URL` at any server that implements it. Provider-specific
reasoning fields are handled when present, so the same service works across
OpenAI-compatible APIs without provider-specific client code.

```typescript
const service = OpenAIChatService.builder()
    .model("your-model")
    .temperature(0.3)
    .maxTokens(2048)
    .create();
```

[Back to top](#readme-top)

## When to use llm-chat

Use llm-chat when you want a typed chat loop, streaming, and tool execution
without adopting an agent framework.

- Use the **raw OpenAI SDK** for single requests or when you only need
  transport.
- Use **Vercel AI SDK** when you want React/Next.js UI streaming hooks.
- Use **LangChain** when you need a large catalog of integrations and
  vector-store abstractions.

[Back to top](#readme-top)

## Troubleshooting

### Missing credentials

`OPENAI_API_KEY` must be a non-empty string. If your endpoint ignores
authentication, use any placeholder value.

### No model provided

Pass a model with `.model("your-model")` or set
`LLM_CHAT_OPENAI_DEFAULT_MODEL`.

### Wrong endpoint

Set `OPENAI_BASE_URL` to the full API prefix, usually ending in `/v1`, for
example `https://api.openai.com/v1`.

### The server rejects `stream_options`

Some OpenAI-compatible servers reject streamed token usage. Leave
`OpenAIChatServiceConfiguration.includeUsage` at its default `false` value.

### System prompt file not found

`systemPromptFile` is resolved from `process.cwd()`. The file must exist when
`init()` or the first `send()` runs, otherwise loading throws.

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
| `ChatService` | Send loop, tool execution, queueing, context handoff | [Chat service](https://johanneslatzel.github.io/llm-chat/services/chat-service/) |
| `Tool` | Typed parameter schema and execution boundary | [Defining tools](https://johanneslatzel.github.io/llm-chat/tools/defining-tools/) |
| `ChunkStream` | Streaming chunks, summaries, and usage | [Stream hooks](https://johanneslatzel.github.io/llm-chat/services/stream-hooks/) |
| Hooks | Stream, message, tool, service, and JSON hooks | [Hooks](https://johanneslatzel.github.io/llm-chat/hooks/) |
| `OpenAIChatServiceConfiguration` | Model, sampling, reasoning, tool choice, usage | [OpenAI service](https://johanneslatzel.github.io/llm-chat/services/openai/) |

### Guides

- [Quick start](https://johanneslatzel.github.io/llm-chat/examples/quick-start/)
- [Building messages](https://johanneslatzel.github.io/llm-chat/chats/building-messages/)
- [Defining tools](https://johanneslatzel.github.io/llm-chat/tools/defining-tools/)
- [Tool packages](https://johanneslatzel.github.io/llm-chat/tools/packages/)
- [Stream hooks](https://johanneslatzel.github.io/llm-chat/services/stream-hooks/)
- [Chat hooks](https://johanneslatzel.github.io/llm-chat/chats/chat-hooks/)
- [Serialization](https://johanneslatzel.github.io/llm-chat/chats/serialization/)
- [Environment variables](https://johanneslatzel.github.io/llm-chat/env/)
- [Architecture](https://johanneslatzel.github.io/llm-chat/architecture/)

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

## Contributing

Issues and pull requests are welcome.

1. Fork the repository and create a feature branch.
2. Run `npm install`.
3. Make the change and add tests.
4. Run `npm run verify`.
5. Open a pull request.

Use conventional commit messages.

## Ecosystem

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

## License

MIT © Johannes B. Latzel. See
[LICENSE](https://github.com/johanneslatzel/llm-chat/blob/main/LICENSE).
