import type { FinishReason } from '../chat/types.js';
import type { CompletionUsage } from './stream-types.js';

/** Discriminant for stream event types yielded by a chat service. */
export enum StreamEventType {
    Content = 'content',
    ToolCallDelta = 'tool_call_delta',
    Usage = 'usage',
    Finish = 'finish',
    Reasoning = 'reasoning'
}

/** A single event yielded by a service's internal stream iterator. */
export type StreamEvent =
    | { type: StreamEventType.Content; text: string }
    | {
          type: StreamEventType.ToolCallDelta;
          index: number;
          id?: string;
          name?: string;
          arguments?: string;
      }
    | { type: StreamEventType.Usage; usage: CompletionUsage }
    | { type: StreamEventType.Finish; reason: FinishReason }
    | { type: StreamEventType.Reasoning; text: string };
