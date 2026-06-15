# ChatService

`ChatService` handles the tool-call loop. It owns the chat instance and tool registry. Tools are registered via `service.tools().add(...)`:

```ts
const config = new ChatServiceConfiguration();
config.maxToolCallRounds = 25;
config.systemPromptDir = "./prompts";
config.userPromptPaths = ["./context.md"];

const service = new OpenAIChatService(api, openAIConfig, config);
const chat = service.chat();
// ... setup messages ...
await service.send();
```

The base class accumulates stream events, assembles tool calls, recurses on tool responses, and errors safely.

### Configuration

| Property | Env var | Default | Description |
|----------|---------|---------|-------------|
| `maxToolCallRounds` | `LLM_CHAT_MAX_TOOL_CALL_ROUNDS` | `10` | Max tool-call recursion depth |
| `systemPromptDir` | `LLM_CHAT_SYSTEM_PROMPT_DIR` | `./prompts/` | Directory of `.md`/`.txt` system prompt files |
| `userPromptPaths` | `LLM_CHAT_USER_PROMPTS` | `""` | Comma-separated file paths for initial user messages |
| `hooksDir` | `LLM_CHAT_HOOKS_DIR` | unset | Directory containing `.json` hook definition files |

## Eager initialisation

By default, prompt files from `systemPromptDir` are loaded lazily on the first
`send()`. Call `init()` to load them upfront, allowing inspection or display of
the full system prompt (e.g. a `/system` command):

```ts
await service.init();
const system = service.chat().getSystem();
// system.content now includes all file-based prompts under general
```

`init()` is idempotent — subsequent calls are no-ops until the next
`service.clear()` or `chat.clear()` call.

If you only need to reload prompt files (e.g. after modifying files on disk
at runtime), call `loadPromptFiles()` directly. Unlike `init()`, it always
re-reads the directory and replaces the `general` container contents.

## Full reset

`service.clear()` resets the entire service to a clean state:

- Calls `JsonHookRegistry.clear()` — disposes all JSON-loaded hooks
- Calls `ChunkStream.clear()` — removes chunks, resets sequence, unregisters chunk listeners
- Calls `Chat.clear()` — removes messages, clears system prompt, unregisters message listeners
- Calls `ToolSuite.clear()` — removes tools and packages, unregisters tool event listeners
- Calls `resetTutorials()` — re-attaches the tutorial container to the fresh system prompt tree
- Resets the internal `_contextLoaded` flag so the next `send()` re-runs `init()` (re-loads prompt files and JSON hooks)

```ts
service.clear();
await service.send(); // re-initialises from scratch
```

## Tutorial reset

When `chat.clear()` is called directly (not through `service.clear()`), tool
tutorials in the system prompt tree are cleared along with everything else. To
re-attach and re-populate them from the still-registered tool packages, call
`resetTutorials()`:

```ts
chat.clear();
service.resetTutorials();
// chat.getSystem() now includes tutorials again
```

## Message queue

`service.queue()` returns a `MessageWriter` that stages messages for the next `send()` call without blocking the send mutex. This is useful when you need to enqueue messages from a concurrent context (timer, interrupt handler, etc.) without waiting for an in-flight request to finish.

```ts
await service.queue().user('Timer "build" (30s) has expired.');
await service.send(); // drains the queue into chat before sending
```

Messages enqueued via `service.queue()` are assigned an origin based on their role (`User` for user messages, `Tool` for tool messages, etc.).

Hooks enqueue messages through a separate `HookMessageWriter` interface. Hook-inserted messages are tagged with `origin: Hook` so they can be distinguished from user-provided or model-generated messages. See [JSON hooks](../hooks/json-hooks.md) for details.

The queue uses its own mutex, so enqueuing is fast and independent of the send and chat mutexes.

For guidance on choosing between direct chat and the queue, see [Building messages — Direct chat vs message queue](../chats/building-messages.md#direct-chat-vs-message-queue).

## Streaming

Stream hooks are documented in [Stream hooks](stream-hooks.md).
