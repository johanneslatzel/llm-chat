# Agent loop

The tool loop inside `send()` handles individual tool calls. An outer loop is
useful when the conversation needs a condition tools cannot express alone, such
as a final submission that passes validation.

This example loops until `submit_answer` accepts a non-empty answer, or until
five rounds have run.

```typescript
import {
    ResultStatus,
    Tool,
    ToolParameterProperty,
    ToolParameters,
    type PartialToolResult,
} from '@johannes.latzel/llm-chat-tool';
import type { ChatService } from '@johannes.latzel/llm-chat';

let answer: string | null = null;

class SubmitAnswerTool extends Tool {
    constructor() {
        super(
            'submit_answer',
            'Submit the final answer.',
            new ToolParameters(
                { answer: ToolParameterProperty.string('Final answer') },
                ['answer']
            )
        );
    }

    protected async onExecute(args: Record<string, unknown>): Promise<PartialToolResult> {
        this.validateRequiredParams(args, ['answer']);

        if (typeof args.answer !== 'string' || args.answer.trim().length === 0) {
            return {
                result: 'answer must be a non-empty string',
                status: ResultStatus.Error
            };
        }

        answer = args.answer;
        return { result: `Accepted: ${answer}`, status: ResultStatus.Success };
    }
}

// Supply a ChatService from a provider package, or subclass ChatService.
declare const service: ChatService;

service.chat()
    .system()
    .child('general')
    .prompt('rules')
    .setContent('Answer the question, then call submit_answer with the final answer.');

service.tools().add(new SubmitAnswerTool());

const maxRounds = 5;
await service.chat().user('What is the capital of France?');

for (let round = 0; answer === null && round < maxRounds; round++) {
    await service.send();

    if (answer === null) {
        await service.chat().user('Call submit_answer with a non-empty final answer.');
    }
}

if (answer === null) {
    throw new Error(`No answer was submitted after ${maxRounds} rounds.`);
}

console.log(`Answer: ${answer}`);
```

## What the loop adds

- `send()` already loops over tool calls within one provider sequence.
- The outer loop calls `send()` again while `answer` is `null`, so the model
  gets another chance with a fresh user message.
- `maxRounds` bounds API usage.
- `submit_answer` assigns `answer` only for a valid result. A rejected
  submission leaves `answer` null and the loop continues.

## See also

- [ChatService tool-call loop](../services/chat-service.md#tool-call-loop)
- [Service hooks](../services/chat-service.md#service-hooks)
- [Tool hooks](https://johanneslatzel.github.io/llm-chat-tool/tools/tool-hooks/)
