import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Mutex } from 'async-mutex';
import { Chat, FinishReason } from './chat.js';
import { ToolSuite } from '../tools/suite.js';
export var StreamEventType;
(function (StreamEventType) {
    StreamEventType["Content"] = "content";
    StreamEventType["ToolCallDelta"] = "tool_call_delta";
    StreamEventType["Finish"] = "finish";
    StreamEventType["Reasoning"] = "reasoning";
})(StreamEventType || (StreamEventType = {}));
export class ChatServiceConfiguration {
    maxToolCallRounds = (() => {
        const raw = process.env.LLM_CHAT_MAX_TOOL_CALL_ROUNDS;
        if (raw === undefined || raw === '')
            return 10;
        const parsed = parseInt(raw, 10);
        return isNaN(parsed) ? 10 : parsed;
    })();
    systemPromptPath = process.env.LLM_CHAT_SYSTEM_PROMPT ?? '';
    userPromptPaths = (process.env.LLM_CHAT_USER_PROMPTS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}
export class ChatService {
    config;
    _contextLoaded = false;
    _sendMutex = new Mutex();
    chatImpl = new Chat();
    _tools = new ToolSuite();
    constructor(config = new ChatServiceConfiguration()) {
        this.config = config;
    }
    tools() {
        return this._tools;
    }
    /** Returns the public-facing chat handle with a narrowed API. */
    chat() {
        return this.chatImpl;
    }
    async _send() {
        if (!this._contextLoaded &&
            (this.config.systemPromptPath || this.config.userPromptPaths.length > 0)) {
            await this.loadPromptFiles();
            this._contextLoaded = true;
        }
        await this.sendLoop(0);
    }
    async send() {
        await this._sendMutex.runExclusive(() => this._send());
    }
    async interrupt(fn, sendAfter) {
        await this._sendMutex.runExclusive(async () => {
            await fn();
            if (sendAfter !== false) {
                await this._send();
            }
        });
    }
    async loadPromptFiles() {
        if (this.config.systemPromptPath) {
            const absPath = path.resolve(process.cwd(), this.config.systemPromptPath);
            try {
                const content = await readFile(absPath, 'utf-8');
                this.chatImpl.system(content);
            }
            catch {
                console.warn(`Failed to load system prompt file: ${absPath}`);
            }
        }
        for (const relPath of this.config.userPromptPaths) {
            const absPath = path.resolve(process.cwd(), relPath);
            try {
                const content = await readFile(absPath, 'utf-8');
                this.chatImpl.user(content);
            }
            catch {
                console.warn(`Failed to load user prompt file: ${absPath}`);
            }
        }
    }
    async sendLoop(iteration) {
        let content = '';
        let reasoningContent = '';
        const toolCallAccumulators = new Map();
        for await (const event of this.createStream()) {
            switch (event.type) {
                case StreamEventType.Content:
                    content += event.text;
                    this.chatImpl.chunk(event.text);
                    break;
                case StreamEventType.ToolCallDelta:
                    this.accumulateToolCall(toolCallAccumulators, event);
                    break;
                case StreamEventType.Finish:
                    await this.handleFinish(content, reasoningContent, toolCallAccumulators, event.reason, iteration);
                    return;
                case StreamEventType.Reasoning:
                    reasoningContent += event.text;
                    break;
            }
        }
        if (reasoningContent) {
            this.chatImpl.reasoning(reasoningContent);
        }
        if (content) {
            this.chatImpl.assistant(content);
        }
    }
    accumulateToolCall(accs, event) {
        let acc = accs.get(event.index);
        if (!acc) {
            acc = { id: '', name: '', arguments: '' };
            accs.set(event.index, acc);
        }
        if (event.id)
            acc.id += event.id;
        if (event.name)
            acc.name += event.name;
        if (event.arguments)
            acc.arguments += event.arguments;
    }
    async handleFinish(content, reasoningContent, toolCallAccumulators, reason, iteration) {
        if (reasoningContent) {
            this.chatImpl.reasoning(reasoningContent);
        }
        this.chatImpl.finish(reason);
        if (reason === FinishReason.Stop || reason === FinishReason.Length) {
            this.chatImpl.assistant(content);
            return;
        }
        if (reason === FinishReason.ToolCalls) {
            if (iteration >= this.config.maxToolCallRounds) {
                this.chatImpl.assistant(content);
                this.chatImpl.user('Your tool call loop was interrupted after reaching the maximum number of rounds. Please summarize your progress so far and continue without further tool calls.');
                await this.sendLoop(iteration + 1);
                return;
            }
            const toolCalls = [];
            for (const acc of toolCallAccumulators.values()) {
                toolCalls.push({
                    id: acc.id,
                    type: 'function',
                    function: { name: acc.name, arguments: acc.arguments }
                });
            }
            this.chatImpl.assistant(content, toolCalls);
            for (const tc of toolCalls) {
                try {
                    const result = await this._tools.executeTool(tc.function.name, tc.function.arguments);
                    this.chatImpl.tool(result.result, tc.id);
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.chatImpl.tool(`Error: ${msg}`, tc.id);
                }
            }
            await this.sendLoop(iteration + 1);
        }
    }
}
//# sourceMappingURL=service.js.map