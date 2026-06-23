# LLM Chat

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![NPM](https://nodei.co/npm/@johannes.latzel/llm-chat.svg?style=shields&data=n,v,u,d,s)](https://www.npmjs.com/package/@johannes.latzel/llm-chat)
[![version](https://img.shields.io/github/package-json/v/johanneslatzel/llm-chat)](https://github.com/johanneslatzel/llm-chat/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat/pulls)
[![Feedback Welcome](https://img.shields.io/badge/feedback-welcome-brightgreen)](https://github.com/johanneslatzel/llm-chat/discussions)
[![codecov](https://codecov.io/gh/johanneslatzel/llm-chat/graph/badge.svg)](https://codecov.io/gh/johanneslatzel/llm-chat)
[![CI](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml/badge.svg)](https://github.com/johanneslatzel/llm-chat/actions/workflows/ci.yml)
[![Socket Badge](https://badge.socket.dev/npm/package/@johannes.latzel/llm-chat/latest)](https://badge.socket.dev/npm/package/@johannes.latzel/llm-chat/latest)
[![AI Assisted Yes](https://img.shields.io/badge/AI%20Assisted-Yes-green)](https://github.com/mefengl/made-by-ai)

Chat agents with typed tool calls, streaming, and hooks. Works with OpenAI-compatible APIs.

## Features

- chunk streaming, message queueing, serializable chat history
- automatic tool-call loop, typed tools parameter validation
- hook into the stream, chat history, and tool calls
- composed system prompts
- configurable via config objects and env vars

## Prerequisites

- Node.js >= 18
- An OpenAI-compatible API endpoint

## Installation

```bash
npm install @johannes.latzel/llm-chat
```

## Documentation

Full documentation at **[johanneslatzel.github.io/llm-chat/](https://johanneslatzel.github.io/llm-chat/)**

## License

MIT — see [`LICENSE`](LICENSE).

## Contributing

Issues and PRs welcome at [github.com/johanneslatzel/llm-chat](https://github.com/johanneslatzel/llm-chat).


## Tools

| Project | Docs | npm | Description |
|---------|------|-----|-------------|
| [llm-chat-time](https://github.com/johanneslatzel/llm-chat-time) | [docs](https://johanneslatzel.github.io/llm-chat-time/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-time) | get datetime, use stopwatch and timers |
| [llm-chat-web](https://github.com/johanneslatzel/llm-chat-web) | [docs](https://johanneslatzel.github.io/llm-chat-web/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-web) | search and fetch the web |
| [llm-chat-file](https://github.com/johanneslatzel/llm-chat-file) | [docs](https://johanneslatzel.github.io/llm-chat-file/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-file) | read/write files and folders |
| [llm-chat-skill](https://github.com/johanneslatzel/llm-chat-skill) | [docs](https://johanneslatzel.github.io/llm-chat-skill/) | [npm](https://www.npmjs.com/package/@johannes.latzel/llm-chat-skill) | load and manage skills |