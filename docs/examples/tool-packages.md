# Tool Packages

A `ToolPackage` groups related tools and can contribute a tutorial to the
system prompt. This example registers a support package with two tools and
prints the generated prompt.

```typescript
import {
    OpenAIChatService,
    ResultStatus,
    Tool,
    ToolPackage,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult
} from '@johannes.latzel/llm-chat';

class GreetTool extends Tool {
    constructor() {
        super(
            'greet',
            'Greet a customer by name.',
            new ToolParameters(
                { name: ToolParameterProperty.string('Customer name') },
                ['name']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return {
            result: `Hello, ${String(args.name)}!`,
            status: ResultStatus.Success
        };
    }
}

class LookupOrderTool extends Tool {
    constructor() {
        super(
            'lookup_order',
            'Look up an order by ID.',
            new ToolParameters(
                { id: ToolParameterProperty.string('Order ID') },
                ['id']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        return args.id === '42'
            ? { result: 'Order 42: shipped', status: ResultStatus.Success }
            : { result: `Order ${String(args.id)} not found`, status: ResultStatus.Error };
    }
}

class SupportPackage extends ToolPackage {
    constructor() {
        super([new GreetTool(), new LookupOrderTool()]);
    }

    tutorial(): string {
        return 'Use greet to welcome a customer and lookup_order to check an order.';
    }
}

const service = OpenAIChatService.builder()
    .systemPrompt('Use the support tools when they apply.')
    .create();

service.tools().add(new SupportPackage());

console.log(service.chat().getSystem()?.content);

await service.chat().user('Where is order 42?');
await service.send();
console.log(service.lastAssistantContent());
```

## Tutorial output

Each package with a non-null `tutorial()` adds a container to the
`tutorials` section of the system prompt:

```text
tutorials
    Tool Package SupportPackage
        Applicability
            greet, lookup_order
        Tutorial
            Use greet to welcome a customer and lookup_order to check an order.
```

## See also

- [Tool packages](../tools/packages.md)
- [Tool calling](tool-calling.md)
- [Defining a tool](../tools/defining-tools.md)
