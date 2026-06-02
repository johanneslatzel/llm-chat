# Building messages

`ChatInterface` serves three purposes:

1. **Prepare** — build the message history the agent will see (system prompt, user messages, seeded assistant/tool messages)
2. **Record** — after `service.send()`, read back what the agent produced via `chat.messages()`
3. **React** — observe the stream in real time via hooks

```ts
chat.system("You are a pirate.");
chat.user("Hello!");

// seed assistant responses or fake tool calls
chat.assistant("Let me check...", [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Berlin"}' } }]);
chat.tool('{"temp":22}', "call_1");
chat.assistant("It's 22°C.");
```
