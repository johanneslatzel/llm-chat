# OpenAIChatService

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

## Timestamp prefix

Set `OpenAIChatServiceConfiguration.prefixWithTimestamp` to prepend each message's `createdAt` timestamp (local-timezone ISO 8601) to its content when sent to the API:

```ts
const openAIConfig = new OpenAIChatServiceConfiguration();
openAIConfig.prefixWithTimestamp = true;
// each message is sent as: "2026-06-04T17:04:35.000+01:00: Hello"

const service = new OpenAIChatService(api, openAIConfig);
```

Useful for giving the model temporal context about when each message was created.
