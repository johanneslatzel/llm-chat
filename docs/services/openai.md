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
