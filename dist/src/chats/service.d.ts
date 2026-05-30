import { Chat, ChatInterface, FinishReason } from './chat.js';
import { ToolSuite, ToolSuiteInterface } from '../tools/suite.js';
export declare enum StreamEventType {
    Content = "content",
    ToolCallDelta = "tool_call_delta",
    Finish = "finish",
    Reasoning = "reasoning"
}
export type StreamEvent = {
    type: StreamEventType.Content;
    text: string;
} | {
    type: StreamEventType.ToolCallDelta;
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
} | {
    type: StreamEventType.Finish;
    reason: FinishReason;
} | {
    type: StreamEventType.Reasoning;
    text: string;
};
export declare class ChatServiceConfiguration {
    maxToolCallRounds: number;
    systemPromptPath: string;
    userPromptPaths: string[];
}
export declare abstract class ChatService {
    private config;
    private _contextLoaded;
    private _sendMutex;
    readonly chatImpl: Chat;
    protected _tools: ToolSuite;
    protected constructor(config?: ChatServiceConfiguration);
    tools(): ToolSuiteInterface;
    /** Returns the public-facing chat handle with a narrowed API. */
    chat(): ChatInterface;
    protected abstract createStream(): AsyncIterable<StreamEvent>;
    private _send;
    send(): Promise<void>;
    interrupt(fn: () => void | Promise<void>, sendAfter?: boolean): Promise<void>;
    private loadPromptFiles;
    private sendLoop;
    private accumulateToolCall;
    private handleFinish;
}
//# sourceMappingURL=service.d.ts.map