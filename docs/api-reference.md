# API reference

## ChatServiceConfiguration

Configuration for a `ChatService`. Most fields can also be set through an
environment variable.

| Property | Default | Environment variable | Description |
|---|---|---|---|
| `maxToolCallRounds` | `10` | `LLM_CHAT_MAX_TOOL_CALL_ROUNDS` | Maximum tool-call rounds |
| `systemPromptDir` | `./prompts/` | `LLM_CHAT_SYSTEM_PROMPT_DIR` | Directory of `.md` and `.txt` system prompt files |
| `userPromptPaths` | `[]` | `LLM_CHAT_USER_PROMPTS` | Comma-separated user prompt file paths; empty by default |
| `hooksDir` | `undefined` | `LLM_CHAT_HOOKS_DIR` | Directory of JSON hook files |
| `systemPrompt` | `undefined` | `LLM_CHAT_SYSTEM_PROMPT` | Flat system prompt; overrides file and directory sources |
| `systemPromptFile` | `undefined` | `LLM_CHAT_SYSTEM_PROMPT_FILE` | Single system prompt file |
| `trimMessages` | `false` |  | Trim assistant and reasoning content before storing |
| `parseInlineReasoning` | `false` | `LLM_CHAT_PARSE_INLINE_REASONING` | Parse inline reasoning markers |
| `inlineReasoningMarkers` | `<think>` / `</think>` |  | Inline reasoning marker pair |
| `parseInlineToolCalls` | `false` | `LLM_CHAT_PARSE_INLINE_TOOL_CALLS` | Parse inline tool-call blocks |
| `inlineToolCallMarkers` | `<tool_call>` / `</tool_call>` |  | Inline tool-call marker pair |
| `contextWindowSizeHint` | `0` | `LLM_CHAT_CONTEXT_WINDOW_SIZE_HINT` | Context window hint in tokens; `0` means unlimited |

## ChatService

Abstract base class for a provider. The constructor is protected.

### `constructor(config?)`

| Param | Type | Default | Description |
|---|---|---|---|
| `config` | `ChatServiceConfiguration` | new configuration | Service configuration |

### Accessors

| Method | Returns | Description |
|---|---|---|
| `chat()` | `ChatInterface` | Conversation history and message methods |
| `queue()` | `MessageWriter` | Stage messages for the next `send()` |
| `stream()` | `ChunkStreamInterface` | Chunks and summaries from the last `send()` |
| `tools()` | `ToolSuiteInterface` | Tool registry |
| `hook()` | service hook builder | Send-loop lifecycle hooks |

### `send()`

Runs the provider request, executes tools, records messages, and fires hooks.
Returns `Promise<void>`.

### `interrupt(needsResend?)`

| Param | Type | Default | Description |
|---|---|---|---|
| `needsResend` | `boolean` | `false` | Retry the request after aborting it |

### `injectToolCall(toolName, args)`

Executes a registered tool and queues an assistant/tool message pair without
calling tool hooks or `send()`.

| Param | Type | Default | Description |
|---|---|---|---|
| `toolName` | `string` |  | Registered tool name |
| `args` | `Record<string, unknown>` |  | Tool arguments |

Returns `Promise<void>`. Throws when the tool is not registered.

### `setNeedsResend()`

Sets the resend flag so the next `send()` retries the request. Returns `void`.

### `lastAssistantContent()`

Returns the most recent assistant content, or `undefined`.

### `lastAssistantJson<T>()`

Parses the most recent assistant output as JSON. Returns `T | undefined` and
throws `StructuredOutputError` when the output is refused, filtered,
incomplete, or invalid JSON.

### `estimateTokens(estimator?)`

| Param | Type | Default | Description |
|---|---|---|---|
| `estimator` | `TokenEstimator` | `CharCountEstimator` | Token estimation strategy |

Returns `Promise<number>`.

### `isContextWindowExceeded(estimator?)`

| Param | Type | Default | Description |
|---|---|---|---|
| `estimator` | `TokenEstimator` | `CharCountEstimator` | Token estimation strategy |

Returns `Promise<boolean>`. Returns `false` when `contextWindowSizeHint` is `0`.

### `init()` and `loadPromptFiles()`

Load prompt files. `init()` is idempotent and safe to call concurrently.
`loadPromptFiles()` reloads the files. Both return `Promise<void>`.

### `clear()` and `resetTutorials()`

`clear()` resets chat, stream, tools, JSON hooks, and tutorials.
`resetTutorials()` re-attaches tool tutorials after a direct `chat.clear()`.
Both return `void`.

### `loadJsonHooks()` and `getJsonHooks()`

`loadJsonHooks()` reloads JSON hook files. `getJsonHooks()` returns metadata
for the registered hooks.

### Provider hooks

| Method | Returns | Description |
|---|---|---|
| `createStream(signal?)` | `AsyncIterable<StreamEvent>` | Abstract provider stream implementation |
| `shouldSendMessage(message)` | `boolean` | Whether a stored message is sent |
| `toOutgoingContent(message)` | `string` | Transform outgoing message content |
| `estimateRequestTokens(estimator)` | `number` | Extra request token estimate |
| `estimateCompletionTokens()` | `number` | Output reserve for the context check |

## ChatInterface

Conversation handle returned by `ChatService.chat()`.

### Message methods

| Method | Returns | Description |
|---|---|---|
| `user(content)` | `Promise<void>` | Append a user message |
| `assistant(content, tool_calls?)` | `Promise<void>` | Append an assistant message |
| `tool(content, tool_call_id)` | `Promise<void>` | Append a tool result |
| `reasoning(content)` | `Promise<void>` | Append a reasoning message |

### History and prompt methods

| Method | Returns | Description |
|---|---|---|
| `sessionId()` | `string` | Session identifier |
| `system()` | `PromptContainer` | System prompt tree |
| `messages()` | `ChatMessage[]` | Conversation messages |
| `getSystem()` | `ChatMessage | null` | Effective system message |
| `toJSON()` | `ChatJSON` | Serialisable conversation |
| `hook()` | `ChatHookBuilder` | Message hooks |
| `clear(retainHooks?)` | `void` | Clear messages and prompt tree |
| `clearMessages()` | `void` | Clear messages only |
| `silent(enable)` | `void` | Suppress or enable message hooks |
| `historicMessages()` | `ChatMessage[]` | Messages archived by handoff |
| `handoff(strategy)` | `Promise<void>` | Compact the conversation |

## ChatJSON and chatFromJSON

`ChatJSON` contains `sessionId`, an optional `systemPrompt` component tree, and
serialised messages with ISO timestamps.

### `chatFromJSON(data)`

| Param | Type | Default | Description |
|---|---|---|---|
| `data` | `ChatJSON` |  | Serialised conversation |

Returns `ChatInterface`.

## HandoffStrategy

| Method | Returns | Description |
|---|---|---|
| `apply(chat)` | `ChatMessage[]` | Return the compacted message list |

## ChunkStreamInterface

Stream handle returned by `ChatService.stream()`.

| Method | Returns | Description |
|---|---|---|
| `chunks()` | `readonly Chunk[]` | Accumulated chunks |
| `finishReason()` | `FinishReason | undefined` | Final finish reason |
| `hook()` | `StreamHookBuilder` | Chunk hooks |
| `summary()` | `readonly StreamSummary[]` | Per-round summaries |
| `clear(retainHooks?)` | `void` | Clear chunks and optionally hooks |
| `clearSummaries()` | `void` | Clear summaries only |

## ChunkType

| Value | Description |
|---|---|
| `Content` | Reply text |
| `Reasoning` | Reasoning text |
| `Refusal` | Refusal text |
| `ToolCallDelta` | Partial tool-call data |
| `Usage` | Token usage |
| `Finish` | Finish reason |

## Chunk types

| Type | Fields |
|---|---|
| `ContentChunk` | `type`, `text`, `timestamp`, `seq`, `batch` |
| `ReasoningChunk` | `type`, `text`, `timestamp`, `seq`, `batch` |
| `RefusalChunk` | `type`, `text`, `timestamp`, `seq`, `batch` |
| `ToolCallDeltaChunk` | `type`, `text`, `toolCallIndex`, optional `toolCallId` and `toolCallName`, `timestamp`, `seq`, `batch` |
| `UsageChunk` | `type`, `usage`, `timestamp`, `seq`, `batch` |
| `FinishChunk` | `type`, `finishReason`, optional `isArtificial`, `timestamp`, `seq`, `batch` |

## StreamSummary

| Field | Type | Description |
|---|---|---|
| `content` | `string` | Content text |
| `reasoning` | `string` | Reasoning text |
| `refusal` | `string` | Refusal text, when present |
| `toolCallCount` | `number` | Tool calls in the round |
| `finishReason` | `FinishReason` | Why the round ended |
| `usage` | `CompletionUsage` | Token usage, when reported |
| `timestamp` | `Date` | Summary creation time |

## CompletionUsage

| Field | Type | Description |
|---|---|---|
| `completion_tokens` | `number` | Generated tokens |
| `prompt_tokens` | `number` | Prompt tokens |
| `total_tokens` | `number` | Prompt plus completion tokens |
| `completion_tokens_details` | object | Optional reasoning and audio token details |
| `prompt_tokens_details` | object | Optional cached and audio token details |

## StreamEventType

| Value | Description |
|---|---|
| `Content` | Content text |
| `Reasoning` | Reasoning text |
| `Refusal` | Refusal text |
| `ToolCallDelta` | Partial tool-call data |
| `Usage` | Token usage |
| `Finish` | Finish reason |

## StreamEvent

| Variant | Fields |
|---|---|
| `Content` | `type`, `text` |
| `Reasoning` | `type`, `text` |
| `Refusal` | `type`, `text` |
| `ToolCallDelta` | `type`, `index`, optional `id`, `name`, `arguments` |
| `Usage` | `type`, `usage` |
| `Finish` | `type`, `reason` |

## TokenEstimator

| Method | Returns | Description |
|---|---|---|
| `estimate(text)` | `number` | Estimated token count |

## CharCountEstimator

`CharCountEstimator` implements `TokenEstimator` with a character-count ratio.

### `constructor(charsPerToken?)`

| Param | Type | Default | Description |
|---|---|---|---|
| `charsPerToken` | `number` | `4` | Characters per token; must be greater than zero |

## ToolSuiteInterface

Tool registry returned by `ChatService.tools()`.

| Method | Returns | Description |
|---|---|---|
| `add(item)` | `void` | Register a tool or tool package |
| `hook()` | `ToolHookBuilder` | Tool lifecycle hooks |
| `clear(retainHooks?)` | `void` | Remove tools and optionally hooks |
| `rebuildTutorials()` | `void` | Rebuild tutorial entries |
| `get(name)` | `Tool | undefined` | Look up a tool |
| `getDefinitions()` | `ToolDefinition[]` | Neutral tool definitions |

## Prompt and PromptContainer

`Prompt` is a leaf system prompt component; `PromptContainer` groups prompts
and containers.

| Class | Constructor | Methods |
|---|---|---|
| `Prompt` | `(title, content, id?)` | `content()`, `setContent(content)`, `toJSON()`, `clear()` |
| `PromptContainer` | `(title, id?)` | `add(component)`, `child(id)`, `prompt(id)`, `content()`, `toJSON()`, `clear()` |

Both provide `id()`, `title()`, `setTitle()`, `hasContent()`, `compose()`,
`message()`, and `toJSON()`.

## ResponseFormatType

| Value | Description |
|---|---|
| `Text` | Plain text |
| `JsonObject` | JSON object mode |
| `JsonSchema` | JSON Schema constrained output |

## Response formats

| Type | Shape |
|---|---|
| `ResponseFormatText` | `{ type: ResponseFormatType.Text }` |
| `ResponseFormatJsonObject` | `{ type: ResponseFormatType.JsonObject }` |
| `ResponseFormatJsonSchema` | `{ type: ResponseFormatType.JsonSchema, json_schema: { name, description?, schema, strict? } }` |

`JsonSchemaResponseOptions` is `{ name, schema, description?, strict? }`.
`JsonSchemaObject` is `Record<string, unknown>`.

## StructuredOutputError

| Member | Type | Description |
|---|---|---|
| `reason` | `StructuredOutputErrorReason` | `Refused`, `Filtered`, `Incomplete`, or `InvalidJson` |
| `message` | `string` | User-facing explanation |

## Hooks

| Builder or type | Owner | Methods |
|---|---|---|
| `ChatHookBuilder` | this package | `message(...roles)` |
| `MessageHookBuilder` | this package | `regex(pattern)`, `maxTriggers(n)`, `do(callback)` |
| `StreamHookBuilder` | this package | `chunks(...types)` |
| `StreamChunkFilterBuilder` | this package | `do(callback)` |
| `ServiceHookBuilder` | this package (returned by `ChatService.hook()`) | `beforeSendLoop()`, `afterSendLoop()`, `beforeSend()`, `afterSend()` |
| `HookBuilderBase<T>` | `@johannes.latzel/llm-chat-tool` | abstract `do(callback)` |
| `HasHooks<TBuilder>` | `@johannes.latzel/llm-chat-tool` | `hook()` |
| `ToolHookBuilder` | `@johannes.latzel/llm-chat-tool` | `filter(...)`, `before()`, `after()`, `error()`, `do(callback)` |
| `Hook` | `@johannes.latzel/llm-chat-tool` | `dispose()` |

`Hook` is returned by `do()`; call `dispose()` to unsubscribe.

`ChunkOfType<T>` extracts the chunk type for a selected `ChunkType`.

## Inline markers

`InlineReasoningMarkers` and `InlineToolCallMarkers` are `{ open, close }`
marker pairs used by the inline parsing configuration.
