# Tool Calling

The model decides when to call `get_weather`. The service executes the tool,
appends the result, and sends it back to the model automatically.

The tool uses [wttr.in](https://wttr.in/), which returns plain text and needs no
API key.

```typescript
import {
    OpenAIChatService,
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult
} from '@johannes.latzel/llm-chat';

class WeatherTool extends Tool {
    constructor() {
        super(
            'get_weather',
            'Get the current weather for a city.',
            new ToolParameters(
                { city: ToolParameterProperty.string('City name') },
                ['city']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        this.validateRequiredParams(args, ['city']);

        const city = args.city;
        if (typeof city !== 'string') {
            return { result: 'city must be a string', status: ResultStatus.Error };
        }

        const response = await fetch(
            `https://wttr.in/${encodeURIComponent(city)}?format=%C+%t`
        );
        if (!response.ok) {
            return {
                result: `Weather request failed: ${response.status}`,
                status: ResultStatus.Error
            };
        }

        const weather = (await response.text()).replace(/\s+/g, ' ').trim();
        return { result: `${weather} in ${city}`, status: ResultStatus.Success };
    }
}

const service = OpenAIChatService.builder()
    .systemPrompt('Use tools when they provide factual data.')
    .create();

service.tools().add(new WeatherTool());

await service.chat().user('What is the weather in Berlin?');
await service.send();
console.log(service.lastAssistantContent());
```

## What happens

1. The model returns a tool call instead of a final answer.
2. The service executes `get_weather`, adds a tool message, and sends the
   conversation to the model again.
3. The loop repeats until the model stops calling tools or reaches
   `maxToolCallRounds`.
4. Tool failures return an error result to the model; they do not throw out of
   `send()`.

## See also

- [Defining a tool](../tools/defining-tools.md)
- [Tool hooks](../tools/tool-hooks.md)
- [ChatService tool-call loop](../services/chat-service.md#tool-call-loop)
