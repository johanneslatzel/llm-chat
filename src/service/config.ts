import { envInt, envFloat, envString } from '../env.js';

/** How much reasoning effort the model should spend (for reasoning models like o3). */
export enum ReasoningEffort {
    None = 'none',
    Minimal = 'minimal',
    Low = 'low',
    Medium = 'medium',
    High = 'high',
    XHigh = 'xhigh'
}

/** Whether the model must, may, or must not call tools. */
export enum ToolChoice {
    None = 'none',
    Auto = 'auto',
    Required = 'required'
}

/** How verbose the streaming output should be. */
export enum Verbosity {
    Low = 'low',
    Medium = 'medium',
    High = 'high'
}

/** Configuration for {@link OpenAIChatService}. Each property reads from environment variables by default. */
export class OpenAIChatServiceConfiguration {
    /** OpenAI model name (default: `LLM_CHAT_OPENAI_DEFAULT_MODEL`). */
    model?: string = envString('LLM_CHAT_OPENAI_DEFAULT_MODEL', '') || undefined;
    /** Sampling temperature (default: `LLM_CHAT_OPENAI_TEMPERATURE`). */
    temperature?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_TEMPERATURE'];
        if (raw === undefined || raw === '') return undefined;
        const n = envFloat('LLM_CHAT_OPENAI_TEMPERATURE', NaN);
        return Number.isNaN(n) ? undefined : n;
    })();
    /** Max tokens per response (default: `LLM_CHAT_OPENAI_MAX_TOKENS`). */
    maxTokens?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_MAX_TOKENS'];
        if (raw === undefined || raw === '') return undefined;
        const n = envInt('LLM_CHAT_OPENAI_MAX_TOKENS', 0, 0);
        return n || undefined;
    })();
    /** Max completion tokens for reasoning models (default: `LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS`). */
    maxCompletionTokens?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS'];
        if (raw === undefined || raw === '') return undefined;
        const n = envInt('LLM_CHAT_OPENAI_MAX_COMPLETION_TOKENS', 0, 0);
        return n || undefined;
    })();
    /** Stop sequences (default: `LLM_CHAT_OPENAI_STOP`). */
    stop?: string | string[];
    /** Top-p nucleus sampling (default: `LLM_CHAT_OPENAI_TOP_P`). */
    topP?: number = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_TOP_P'];
        if (raw === undefined || raw === '') return undefined;
        const n = envFloat('LLM_CHAT_OPENAI_TOP_P', NaN);
        return Number.isNaN(n) ? undefined : n;
    })();
    /** Map system messages to the `developer` role (for o-series models). */
    useDeveloperRole?: boolean = false;
    /** Strip reasoning/thinking content from the final output. */
    filterReasoning?: boolean = true;
    /** Prepend each message with an ISO timestamp. */
    prefixWithTimestamp?: boolean = false;
    /** Reasoning effort hint (default: `LLM_CHAT_OPENAI_REASONING_EFFORT`). */
    reasoningEffort?: ReasoningEffort = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_REASONING_EFFORT'];
        if (!raw) return undefined;
        const val = raw.toLowerCase() as ReasoningEffort;
        return Object.values(ReasoningEffort).includes(val) ? val : undefined;
    })();
    /** Tool call policy (default: `LLM_CHAT_OPENAI_TOOL_CHOICE`). */
    toolChoice?: ToolChoice = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_TOOL_CHOICE'];
        if (!raw) return undefined;
        const val = raw.toLowerCase() as ToolChoice;
        return Object.values(ToolChoice).includes(val) ? val : undefined;
    })();
    /** Streaming verbosity (default: `LLM_CHAT_OPENAI_VERBOSITY`). */
    verbosity?: Verbosity = (() => {
        const raw = process.env['LLM_CHAT_OPENAI_VERBOSITY'];
        if (!raw) return undefined;
        const val = raw.toLowerCase() as Verbosity;
        return Object.values(Verbosity).includes(val) ? val : undefined;
    })();
}
