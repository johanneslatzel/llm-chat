import OpenAI from 'openai';
import { ChatService, ChatServiceConfiguration, StreamEvent } from './service.js';
export declare class OpenAIChatServiceConfiguration {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    maxCompletionTokens?: number;
    stop?: string | string[];
    topP?: number;
    filterReasoning?: boolean;
}
export declare class OpenAIChatService extends ChatService {
    private api;
    private openAIConfig;
    constructor(api?: OpenAI, openAIConfig?: OpenAIChatServiceConfiguration, config?: ChatServiceConfiguration);
    protected createStream(): AsyncIterable<StreamEvent>;
}
//# sourceMappingURL=openai.d.ts.map