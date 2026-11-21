# System prompts

A system prompt can come from a flat string, a single file, a directory of
files, or a tree built in code. The snippets below are independent.

## Flat string

A flat string bypasses the prompt tree.

```typescript
import { ChatServiceConfiguration } from '@johannes.latzel/llm-chat';

const config = new ChatServiceConfiguration();
config.systemPrompt = 'You are a concise assistant.';
```

Set `LLM_CHAT_SYSTEM_PROMPT` to use a flat prompt from the environment.

## Single file

Load one `.md` or `.txt` file as the flat prompt.

```typescript
import { ChatServiceConfiguration, type ChatService } from '@johannes.latzel/llm-chat';

const config = new ChatServiceConfiguration();
config.systemPromptFile = 'AGENTS.md';

// Build the ChatService with `config`.
declare const service: ChatService;

await service.init();
console.log(service.chat().getSystem()?.content);
```

The path is resolved from `process.cwd()`. Loading throws when the file is
missing. Set `LLM_CHAT_SYSTEM_PROMPT_FILE` to use this source via the
environment.

## Directory

Each `.md` or `.txt` file in the directory becomes a component under the
`general` container. The filename without the extension becomes the prompt ID.

```text
prompts/
  persona.md
  rules.md
```

```typescript
import { ChatServiceConfiguration, type ChatService } from '@johannes.latzel/llm-chat';

const config = new ChatServiceConfiguration();
config.systemPromptDir = './prompts';

// Build your ChatService with `config`.
declare const service: ChatService;

await service.init();
console.log(service.chat().getSystem()?.content);
```

The directory is read only if it exists. It is never created. Set
`LLM_CHAT_SYSTEM_PROMPT_DIR` to use this source via the environment.

## Prompt tree

Build the tree directly when the prompt needs explicit names and ordering.

```typescript
import type { ChatService } from '@johannes.latzel/llm-chat';

declare const service: ChatService;

const general = service.chat().system().child('general');
general.prompt('persona').setContent('You are a concise assistant.');
general.prompt('rules').setContent('Answer in one paragraph.');
general.prompt('context').setContent('The user is working on a TypeScript service.');

console.log(service.chat().getSystem()?.content);
```

`chat.getSystem()` returns the effective system message. `chat.system()` always
exposes the tree.

## Precedence

When several sources are configured, the order is:

1. Flat string from `systemPrompt` or `LLM_CHAT_SYSTEM_PROMPT`
2. Single file from `systemPromptFile` or `LLM_CHAT_SYSTEM_PROMPT_FILE`
3. Directory from `systemPromptDir` or `LLM_CHAT_SYSTEM_PROMPT_DIR`

Only the winning source is used.

```bash
LLM_CHAT_SYSTEM_PROMPT='You are a concise assistant.'
LLM_CHAT_SYSTEM_PROMPT_FILE=AGENTS.md
LLM_CHAT_SYSTEM_PROMPT_DIR=./prompts
```

With all three set, the flat string wins.

## See also

- [Building messages](../chats/building-messages.md)
- [Adding a new provider](../services/custom-provider.md)
- [Environment variables](../env.md)
