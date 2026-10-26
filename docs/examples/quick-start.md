# Quick Start

## Basic chat

```typescript
import { ChunkType, OpenAIChatService } from "@johannes.latzel/llm-chat";

const service = OpenAIChatService.builder()
    .model("your-model")
    .systemPrompt("You are a concise assistant.")
    .create();

service.stream()
    .hook()
    .chunks(ChunkType.Content)
    .do((chunk) => process.stdout.write(chunk.text));

service.chat().user("What can you do?");
await service.send();
```

`OPENAI_API_KEY` and `OPENAI_BASE_URL` configure the OpenAI client. The builder
covers common options; `withOpenAIConfig()` and `withServiceConfig()` cover
advanced settings. See [Environment Variables](../env.md).

## With tools

```typescript
import {
    OpenAIChatService,
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters
} from "@johannes.latzel/llm-chat";

class GreetTool extends Tool {
    constructor() {
        super(
            "greet",
            "Greets a person by name.",
            new ToolParameters({ name: ToolParameterProperty.string("Name") }, ["name"])
        );
    }

    protected async onExecute(args: Record<string, unknown>) {
        const name = args.name;
        return typeof name === "string"
            ? { result: `Hello, ${name}!`, status: ResultStatus.Success }
            : { result: "name must be a string", status: ResultStatus.Error };
    }
}

const service = OpenAIChatService.builder()
    .model("your-model")
    .create();
service.tools().add(new GreetTool());

service.chat().user("Greet Ada.");
await service.send();
```
