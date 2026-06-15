# Building messages

`ChatInterface` serves three purposes:

1. **Prepare** — build the message history the agent will see (system prompt, user messages, seeded assistant/tool messages)
2. **Record** — after `service.send()`, read back what the agent produced via `chat.messages()`
3. **React** — observe the stream in real time via hooks

## System prompt

The system prompt is built from a tree of components via `chat.system()`, which
returns the root `PromptContainer`. Two standard child containers are available
for organisation:

- **`chat.system().child('general')`** — for persona, rules, domain, behavior, and other general system prompt components
- **`chat.system().child('tutorials')`** — populated automatically by `ToolSuite` when tool packages with tutorial content are registered

General prompt files can be loaded automatically from a directory via
`ChatServiceConfiguration.systemPromptDir` (env: `LLM_CHAT_SYSTEM_PROMPT_DIR`).
All `.md` and `.txt` files in the directory are loaded as components under
`general`, with the filename (without extension) as the prompt ID.
Files with any other extension are ignored.

When the directory is first accessed (on the first `send()`), a set of
default empty files is created. You can add your own `.md` or `.txt`
files and they will be loaded as additional `general > <filename>` components.

The default categories are derived from real-world system prompts
collected at
[https://github.com/dontriskit/awesome-ai-system-prompts](https://github.com/dontriskit/awesome-ai-system-prompts).

| File               | Prompt ID              | Purpose |
|--------------------|------------------------|---------|
| `persona.md`       | `general > persona`    | Role & identity — who the AI is, who created it, its purpose |
| `rules.md`         | `general > rules`      | General instructions & constraints — behavioral rules, meta-instructions, dos/donts |
| `behavior.md`      | `general > behavior`   | Tone & interaction style — how to communicate, adapt to the user |
| `domain.md`        | `general > domain`     | Domain-specific knowledge — tech stack, libraries, conventions |
| `environment.md`   | `general > environment`| System context — OS, platform, IDE, sandbox, capabilities |
| `safety.md`        | `general > safety`     | Refusal protocols & alignment — what to refuse, how to refuse |
| `reasoning.md`     | `general > reasoning`  | Planning & thinking — step-by-step reasoning, agent loops |
| `capabilities.md`  | `general > capabilities`| Task definitions — what the AI excels at, broad task categories |

## Tutorial container

The `tutorials` child container is populated automatically by `ToolSuite`.
When a `ToolPackage` with a non-null `tutorial()` return value is registered,
the suite creates a sub-container titled `Tool Package <ClassName>` with two
children:

- **Applicability** — comma-separated list of tool names in the package
- **Tutorial** — the value returned by `tutorial()`

For example, registering a `WeatherPackage` whose `tutorial()` returns
`"Use greet to say hello and weather to check conditions."` produces:

```
tutorials
    Tool Package WeatherPackage
        Applicability
            greet, weather
        Tutorial
            Use greet to say hello and weather to check conditions.
```

This is injected into the system prompt tree under `chat.system().child('tutorials')`,
so it appears in every conversation alongside the general prompts.

The system prompt is stored separately from the regular message list:

- **`chat.messages()`** — returns only user, assistant, tool, and reasoning messages. The system message is **not** included.
- **`chat.getSystem()`** — returns the system message, or `null` if none has been set.

When `service.send()` sends messages to the provider, the system prompt is always the first element.

Every message is automatically timestamped with a `createdAt: Date` set at creation time and tagged with an `origin` field (`ChatMessageOrigin`) indicating whether it came from the user, the model, a tool, a hook, or the system prompt.

## Adding messages

```ts
chat.system().child('general').prompt('persona').setContent("You are a pirate.");
chat.user("Hello!");

// seed assistant responses or fake tool calls
chat.assistant("Let me check...", [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Berlin"}' } }]);
chat.tool('{"temp":22}', "call_1");
chat.assistant("It's 22°C.");
```

## Direct chat vs message queue

Messages can be added in two ways — directly on the chat handle or via the message queue. Choose based on your timing and concurrency needs.

### Direct chat (`chat.xxx()`)

Use `chat.user()`, `chat.assistant()`, `chat.tool()` when you want to:

- **Build history before sending** — prepare the conversation that will be sent to the LLM on the next `service.send()`.
- **Record model output** — after `service.send()` returns, the service uses direct chat internally to record assistant responses and tool results.
- **Fire message hooks immediately** — appending triggers any registered message hooks in real time.

Messages are appended immediately under the chat's own mutex.

### Message queue (`service.queue().xxx()`)

Use `service.queue().user()`, `service.queue().tool()` when you need to:

- **Enqueue from concurrent contexts** — timers, interrupt handlers, or any code that runs while an in-flight `send()` is executing. The queue has its own mutex and won't block the send.
- **Stage messages without triggering hooks** — queued messages sit in a buffer. No hooks fire during enqueue.
- **Inject from JSON hooks** — hook definitions with the `queue-message` action write to the same queue, tagged with `origin: Hook`.

Messages are drained into the chat at the start of the next `service.send()` call. At that point they fire message hooks like any other added message. See [ChatService message queue](../services/chat-service.md#message-queue) for details.

### Hook-specific variant

Hooks use a separate `HookMessageWriter` interface (backed by the same `MessageQueue`) to enqueue messages with an explicit `origin` parameter. See [HookMessageWriter](../hooks/hook-message-writer.md).

### Quick reference

| Use this | When you need ... |
|----------|-------------------|
| `chat.user()` / `chat.assistant()` / `chat.tool()` | Immediate appending, hook firing, building history before `send()` |
| `service.queue().user()` / `service.queue().tool()` | Concurrent staging, deferred processing, hook injection |

## Clearing

`chat.clear()` removes all conversation messages, clears the system prompt
tree (children are removed, title is reset), and unregisters any message hook
listeners. The same `PromptContainer` root stays in place — children are
cleared rather than replaced:

```ts
chat.system().child('general').prompt('persona').setContent("You are a pirate.");
chat.user("Hello!");
chat.clear();
chat.messages(); // []
chat.getSystem(); // null
```

Pass `retainHooks: true` to preserve message hooks across the reset:

```ts
const hook = chat.hook().message(ChatRole.User).do(cb);
chat.clear(true);   // hook survives
```

If tool packages with tutorials were registered, call `service.resetTutorials()`
after `chat.clear()` to re-attach and re-populate the `tutorials` child container
in the fresh system prompt tree. See [ChatService](../services/chat-service.md).

To reset the entire service (chat, stream, tools, and JSON hooks) in one call,
use `service.clear()` — see [ChatService](../services/chat-service.md).
