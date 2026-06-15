import { describe, it, expect } from 'vitest';
import {
    ChatMessageOrigin,
    ChatRole,
    FinishReason,
    ChatServiceConfiguration,
    Tool,
    ToolParameters,
    ResultStatus,
    Hook,
    HookBuilderBase,
    ChunkType,
} from '../../src/index.js';

describe('package exports', () => {
    it('exports all expected symbols', () => {
        expect(ChatMessageOrigin).toBeDefined();
        expect(ChatRole).toBeDefined();
        expect(FinishReason).toBeDefined();
        expect(ChatServiceConfiguration).toBeDefined();
        expect(Tool).toBeDefined();
        expect(ToolParameters).toBeDefined();
        expect(ResultStatus).toBeDefined();
        expect(Hook).toBeDefined();
        expect(HookBuilderBase).toBeDefined();
        expect(ChunkType).toBeDefined();
    });
});
