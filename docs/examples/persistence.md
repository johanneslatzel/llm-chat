# Persistence

Save a transcript to disk and resume it in a new process. The script reads one
message from the command line, sends it, and writes the updated session back to
`session.json`.

```typescript
import { readFile, writeFile } from 'node:fs/promises';
import {
    chatFromJSON,
    ChatServiceConfiguration,
    type ChatJSON,
    type ChatService,
} from '@johannes.latzel/llm-chat';

const SESSION_FILE = 'session.json';
const DEFAULT_SYSTEM_PROMPT =
    'You are a concise assistant. Remember details from earlier turns.';

type SessionFile = {
    systemPrompt: string;
    chat: ChatJSON;
};

const raw = await readFile(SESSION_FILE, 'utf8').catch(() => null);
const saved = raw ? (JSON.parse(raw) as SessionFile) : null;
const systemPrompt = saved?.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

const config = new ChatServiceConfiguration();
config.systemPrompt = systemPrompt;

// Build the ChatService with `config` before restoring the snapshot.
declare const service: ChatService;

if (saved) {
    const snapshot = chatFromJSON(saved.chat);
    await service.chat().handoff({ apply: () => snapshot.messages() });
    console.error(`[session] restored ${snapshot.messages().length} messages`);
}

const input = process.argv.slice(2).join(' ').trim();
if (!input) {
    console.error('Usage: persistence.ts "message"');
    process.exit(1);
}

await service.chat().user(input);
await service.send();
console.log(service.lastAssistantContent());

const session: SessionFile = {
    systemPrompt,
    chat: service.chat().toJSON()
};
await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
console.error(`[session] saved ${service.chat().messages().length} messages`);
```

## What is stored

- `chat.toJSON()` contains the session ID, the prompt tree, and every
  non-system message with an ISO timestamp.
- The flat system prompt is stored separately because a service-level
  `systemPrompt` is not part of the prompt tree.
- `chatFromJSON()` restores the snapshot. `chat.handoff()` replaces the live
  conversation with the restored messages, so timestamps, tool calls, and
  origins survive.

Tool registrations and hooks are runtime state. Register them before the
resumed turn. The live service chat keeps its own session ID.

## See also

- [Serialization](../chats/serialization.md)
- [Context window handoff](../services/chat-service.md#context-window-handoff)
- [Building messages](../chats/building-messages.md)
