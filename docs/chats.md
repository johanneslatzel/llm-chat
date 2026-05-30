# Chats

`ChatInterface` serves three purposes:

1. **Prepare** — build the message history the agent will see (system prompt, user messages, seeded assistant/tool messages)
2. **Record** — after `service.send()`, read back what the agent produced via `chat.messages()`
3. **React** — observe the stream in real time via hooks

## Building messages

```ts
chat.system("You are a pirate.");  // replaces system prompt
chat.user("Hello!");

// seed assistant responses or fake tool calls
chat.assistant("Let me check...", [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Berlin"}' } }]);
chat.tool('{"temp":22}', "call_1");
chat.assistant("It's 22°C.");
```

## Hooks

All observation is done through hooks returned by `chat.hook()`.

### Streaming

```ts
chat.hook().chunk((_, text) => process.stdout.write(text));
chat.hook().reasoning((_, text) => process.stdout.write(text));
chat.hook().finish((_, reason) => console.log("\nFinished:", reason));
```

Stream hooks fire on every event with no filtering or limit.

### Message hooks

Subscribe to messages matching a role and/or regex:

```ts
chat.hook()
    .message(ChatRole.User)              // optional: filter by role(s)
    .regex(/hello/i)                     // optional: filter by regex
    .maxTriggers(3)                      // default: Infinity
    .do((message, matches) => {
        console.log(message.content);
        console.log(matches[0]);    // full match
    });
```

| `roles` | `regex` | Behavior |
|---------|---------|----------|
| unset | unset | Nothing matches |
| set | unset | Matches any message with that role |
| unset | set | Matches any message matching the regex |
| set | set | Matches only if role AND regex match |

`message()` accepts multiple roles: `.message(ChatRole.User, ChatRole.Assistant)`.

### Disposal

```ts
const hook = chat.hook().chunk((_, text) => process.stdout.write(text));
hook.dispose();  // unsubscribe — safe to call multiple times
```

## Serialization

```ts
const json = chat.toJSON();           // { systemMessage, messages }
const restored = chatFromJSON(json);  // restore (register hooks again after)
```

Hooks are not serialized — re-register after `chatFromJSON()`.

## ChatInterface

The chat handle returned by `service.chat()` implements `ChatInterface`:

```ts
interface ChatInterface {
    user(content: string): void;
    system(content: string): void;
    assistant(content: string, tool_calls?: ToolCall[]): void;
    tool(content: string, tool_call_id: string): void;
    messages(): ChatMessage[];
    toJSON(): ChatJSON;
    hook(): HookBuilder;
}
```

This is the complete public API. Methods like `chunk()`, `reasoning()`, and `finish()` are only accessible to service implementations via the concrete `Chat` class.

## ChatService

`ChatService` handles the tool-call loop. The internal `Chat` and `ToolSuite` are created automatically. Tools are registered via `service.tools().add(...)`:

```ts
const config = new ChatServiceConfiguration();
config.maxToolCallRounds = 25;
config.systemPromptPath = "./prompt.md";
config.userPromptPaths = ["./context.md"];

const service = new OpenAIChatService(api, openAIConfig, config);
const chat = service.chat();
// ... setup messages ...
await service.send();
```

The base class accumulates stream events, assembles tool calls, recurses on tool responses, and errors safely.

## OpenAIChatService

Works with any OpenAI-compatible API (OpenAI, LM Studio, etc.). Reasoning messages are stored locally but filtered out when sent to the API.

```ts
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.model = "some-model";
openAIConfig.temperature = 0.3;
openAIConfig.maxTokens = 2048;
openAIConfig.stop = ["\n\n"];
openAIConfig.topP = 0.9;

const service = new OpenAIChatService(api, openAIConfig, config);
const chat = service.chat();
await service.send();
```

## Adding a new provider

Extend `ChatService` and implement `createStream()`:

```ts
class AnthropicChatService extends ChatService {
    protected async *createStream(): AsyncIterable<StreamEvent> {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            body: JSON.stringify({ /* ... */ })
        });
        for await (const event of parseSSE(response)) {
            yield event; // StreamEvent values
        }
    }
}
```
