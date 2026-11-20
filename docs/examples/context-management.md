# Context Management

`ChatService` can estimate the size of the next request and compact the history
before it reaches the model. This example keeps the last six messages and
replaces older messages with a model-generated summary.

The context hint is set to 1,000 tokens so compaction runs during the example.
Set the model's real context window in production.

```typescript
import {
    ChatMessageOrigin,
    ChatRole,
    ChatServiceConfiguration,
    OpenAIChatService,
    type ChatInterface,
    type ChatMessage
} from '@johannes.latzel/llm-chat';

const KEEP_RECENT = 6;

const config = new ChatServiceConfiguration();
config.contextWindowSizeHint = 1_000;

const service = OpenAIChatService.builder()
    .withServiceConfig(config)
    .systemPrompt('You are a concise assistant.')
    .create();

const summarizer = OpenAIChatService.builder()
    .systemPrompt(
        'Summarise the conversation. Keep decisions, facts, and open questions. Return only the summary.'
    )
    .create();

async function summarize(messages: ChatMessage[]): Promise<string> {
    const transcript = messages
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n');

    summarizer.chat().clear();
    await summarizer.chat().user(`Summarise this conversation:\n\n${transcript}`);
    await summarizer.send();

    const answer = summarizer
        .chat()
        .messages()
        .findLast((message) => message.role === ChatRole.Assistant);

    if (!answer) throw new Error('The summarizer returned no assistant message.');
    return answer.content;
}

async function compact(chat: ChatInterface): Promise<void> {
    const messages = chat.messages();
    if (messages.length <= KEEP_RECENT) return;

    const older = messages.slice(0, -KEEP_RECENT);
    const recent = messages.slice(-KEEP_RECENT);
    const summary = await summarize(older);

    await chat.handoff({
        apply() {
            return [
                {
                    role: ChatRole.User,
                    content: `Summary of the earlier conversation:\n${summary}`,
                    createdAt: new Date(),
                    origin: ChatMessageOrigin.Model
                },
                ...recent
            ];
        }
    });

    console.error(`[context] archived ${older.length} messages`);
}

async function sendTurn(text: string): Promise<void> {
    await service.chat().user(text);

    const tokens = await service.estimateTokens();
    console.error(`[context] ~${tokens} tokens before send`);

    if (await service.isContextWindowExceeded()) {
        await compact(service.chat());
    }

    await service.send();
    console.log(service.lastAssistantContent());
}

await sendTurn('The deployment target is Kubernetes in eu-west-1.');
await sendTurn('The service must keep p95 latency below 200 ms.');
await sendTurn('Use Postgres for persistence and Redis for caching.');
await sendTurn('Summarise the deployment constraints we agreed on.');
```

## How compaction works

- `estimateTokens()` counts the system prompt, messages, queue, and tool
  definitions. `isContextWindowExceeded()` compares the result with
  `contextWindowSizeHint`.
- The summary is generated before `chat.handoff()` because the handoff strategy
  is synchronous.
- `handoff()` archives the current messages in `historicMessages()` and replaces
  them with the summary plus the recent window.

Tool messages inside the recent window are preserved. A summary of a tool result
is plain text, so the model cannot replay the call.

## See also

- [Context window estimation](../services/chat-service.md#context-window-estimation)
- [Context window handoff](../services/chat-service.md#context-window-handoff)
- [Token estimator](../services/chat-service.md#strategy-pattern)
