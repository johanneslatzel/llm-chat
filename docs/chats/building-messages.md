# Building messages

`ChatInterface` serves three purposes:

1. **Prepare** — build the message history the agent will see (system prompt, user messages, seeded assistant/tool messages)
2. **Record** — after `service.send()`, read back what the agent produced via `chat.messages()`
3. **React** — observe the stream in real time via hooks

## System prompt

The system prompt is a single message set via `chat.system()`. Calling it again **replaces** the previous content. The system prompt is stored separately from the regular message list:

- **`chat.messages()`** — returns only user, assistant, tool, and reasoning messages. The system message is **not** included.
- **`chat.getSystem()`** — returns the system message, or `null` if none has been set.

When `service.send()` sends messages to the provider, the system prompt is always the first element.

Every message is automatically timestamped with a `createdAt: Date` set at creation time.

## Adding messages

```ts
chat.system("You are a pirate.");
chat.user("Hello!");

// seed assistant responses or fake tool calls
chat.assistant("Let me check...", [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Berlin"}' } }]);
chat.tool('{"temp":22}', "call_1");
chat.assistant("It's 22°C.");
```

## Clearing

`chat.clear()` removes both the message history and the system prompt:

```ts
chat.system("You are a pirate.");
chat.user("Hello!");
chat.clear();
chat.messages(); // [] — system prompt is gone too
```
