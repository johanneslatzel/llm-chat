# Quick Start

## Basic chat

```ts
import { OpenAIChatService } from "@johannes.latzel/llm-chat";

const service = new OpenAIChatService();
const chat = service.chat();

// build the message history
chat.system("You are a helpful assistant.");
chat.user("What is the weather in Berlin?");

// send to the model and stream the response
await service.send();

// read the full conversation
for (const msg of chat.messages()) {
    console.log(msg.role, msg.content);
}
```

> Set `LLM_CHAT_OPENAI_DEFAULT_MODEL`, `OPENAI_BASE_URL`, and `OPENAI_API_KEY` as environment variables (or load them from `.env` with your own dotenv setup). See [Environment Variables](../env.md).

## With tools

```ts
import { OpenAIChatService, Tool, ToolParameters, ToolParameterProperty, ResultStatus, ChunkType } from "@johannes.latzel/llm-chat";

class GreetTool extends Tool {
    constructor() {
        super("greet", "Greets a person by name.", new ToolParameters(
            { name: new ToolParameterProperty("The name to greet") }, ["name"]
        ));
    }
    protected async onExecute(args: Record<string, unknown>) {
        const name = args.name;
        return typeof name === "string"
            ? { result: `Hello, ${name}!`, status: ResultStatus.Success }
            : { result: "name must be a string", status: ResultStatus.Error };
    }
}

const service = new OpenAIChatService();
service.tools().add(new GreetTool());
const chat = service.chat();

service.stream().hook().chunks(ChunkType.Content).do((chunk) => process.stdout.write(chunk.text));
service.stream().hook().chunks(ChunkType.Reasoning).do((chunk) => process.stdout.write(chunk.text));
service.stream().hook().chunks(ChunkType.Finish).do((chunk) => console.log("\nFinished:", chunk.finishReason));

await service.send();
```
