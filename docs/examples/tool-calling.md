# Tool calling

The model decides when to call `get_weather`. The service executes the tool,
appends the result, and sends it back to the model automatically. This is the
engine's tool integration point: the tool itself is defined with
`@johannes.latzel/llm-chat-tool`, while `ChatService` owns the loop.

The tool uses [wttr.in](https://wttr.in/), which returns plain text and needs no
API key.

```typescript
import {
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult,
} from '@johannes.latzel/llm-chat-tool';
import type { ChatService } from '@johannes.latzel/llm-chat';

class WeatherTool extends Tool {
    constructor() {
        super(
            'get_weather',
            'Get the current weather for a city.',
            new ToolParameters(
                { city: ToolParameterProperty.string('City name') },
                ['city'],
            ),
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        this.validateRequiredParams(args, ['city']);

        const city = args.city;
        if (typeof city !== 'string') {
            return { result: 'city must be a string', status: ResultStatus.Error };
        }

        const response = await fetch(
            `https://wttr.in/${encodeURIComponent(city)}?format=%C+%t`,
        );
        if (!response.ok) {
            return {
                result: `Weather request failed: ${response.status}`,
                status: ResultStatus.Error,
            };
        }

        const weather = (await response.text()).replace(/\s+/g, ' ').trim();
        return { result: `${weather} in ${city}`, status: ResultStatus.Success };
    }
}

// Supply a ChatService from a provider package, or subclass ChatService.
declare const service: ChatService;

service.chat()
    .system()
    .child('general')
    .prompt('rules')
    .setContent('Use tools when they provide factual data.');

service.tools().add(new WeatherTool());

service.chat().user('What is the weather in Berlin?');
await service.send();

console.log(service.lastAssistantContent());
```

## What happens

1. The model returns tool-call deltas and a `tool_calls` finish reason instead
   of a final answer.
2. The service executes `get_weather`, appends the result as a tool message,
   and sends the conversation to the model again.
3. The loop repeats until the model stops calling tools or reaches
   `maxToolCallRounds`.
4. Tool failures return an error result to the model; they do not throw out of
   `send()`.

## See also

- [ChatService tool-call loop](../services/chat-service.md#tool-call-loop)
- [Defining a tool](https://johanneslatzel.github.io/llm-chat-tool/tools/defining-tools/)
- [Tool hooks](https://johanneslatzel.github.io/llm-chat-tool/tools/tool-hooks/)
- [Executing a tool](https://johanneslatzel.github.io/llm-chat-tool/examples/executing-tools/)
