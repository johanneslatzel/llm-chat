import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatServiceConfiguration } from '../../../src/index.js';
import { DEFAULT_INLINE_REASONING_MARKERS } from '../../../src/service/inline-reasoning.js';

describe('ChatServiceConfiguration', () => {
    let config: ChatServiceConfiguration;

    beforeEach(() => {
        config = new ChatServiceConfiguration();
        config.systemPromptDir = '';
        config.userPromptPaths = [];
    });

    it('uses default maxToolCallRounds of 10', () => {
        expect(config.maxToolCallRounds).toBe(10);
    });

    it('reads maxToolCallRounds from env', () => {
        vi.stubEnv('LLM_CHAT_MAX_TOOL_CALL_ROUNDS', '5');
        const c = new ChatServiceConfiguration();
        expect(c.maxToolCallRounds).toBe(5);
        vi.unstubAllEnvs();
    });

    it('falls back to default when env is invalid', () => {
        vi.stubEnv('LLM_CHAT_MAX_TOOL_CALL_ROUNDS', 'not-a-number');
        const c = new ChatServiceConfiguration();
        expect(c.maxToolCallRounds).toBe(10);
        vi.unstubAllEnvs();
    });

    it('falls back to ./prompts/ as systemPromptDir when neither env nor config is set', () => {
        const c = new ChatServiceConfiguration();
        expect(c.systemPromptDir).toBe('./prompts/');
    });

    it('hooksDir defaults to undefined', () => {
        const c = new ChatServiceConfiguration();
        expect(c.hooksDir).toBeUndefined();
    });

    it('hooksDir setter stores value', () => {
        const c = new ChatServiceConfiguration();
        c.hooksDir = './my-hooks';
        expect(c.hooksDir).toBe('./my-hooks');
    });

    it('hooksDir reads from env var with priority over setter', () => {
        vi.stubEnv('LLM_CHAT_HOOKS_DIR', '/env/hooks');
        const c = new ChatServiceConfiguration();
        c.hooksDir = './my-hooks';
        expect(c.hooksDir).toBe('/env/hooks');
        vi.unstubAllEnvs();
    });

    it('defaults parseInlineReasoning to false', () => {
        expect(config.parseInlineReasoning).toBe(false);
    });

    it('reads parseInlineReasoning from env', () => {
        vi.stubEnv('LLM_CHAT_PARSE_INLINE_REASONING', 'true');
        const c = new ChatServiceConfiguration();
        expect(c.parseInlineReasoning).toBe(true);
        vi.unstubAllEnvs();
    });

    it('disables parseInlineReasoning when env is false', () => {
        vi.stubEnv('LLM_CHAT_PARSE_INLINE_REASONING', 'false');
        const c = new ChatServiceConfiguration();
        expect(c.parseInlineReasoning).toBe(false);
        vi.unstubAllEnvs();
    });

    it('falls back to false for an invalid parseInlineReasoning env value', () => {
        vi.stubEnv('LLM_CHAT_PARSE_INLINE_REASONING', 'invalid');
        const c = new ChatServiceConfiguration();
        expect(c.parseInlineReasoning).toBe(false);
        vi.unstubAllEnvs();
    });

    it('uses the default inline reasoning markers', () => {
        expect(config.inlineReasoningMarkers).toEqual(DEFAULT_INLINE_REASONING_MARKERS);
    });

    it('allows overriding inlineReasoningMarkers', () => {
        const c = new ChatServiceConfiguration();
        c.inlineReasoningMarkers = {
            open: '<reasoning>',
            close: '</reasoning>'
        };
        expect(c.inlineReasoningMarkers).toEqual({
            open: '<reasoning>',
            close: '</reasoning>'
        });
    });

    it('defaults parseInlineToolCalls to false', () => {
        expect(config.parseInlineToolCalls).toBe(false);
    });

    it('reads parseInlineToolCalls from env', () => {
        vi.stubEnv('LLM_CHAT_PARSE_INLINE_TOOL_CALLS', 'true');
        const c = new ChatServiceConfiguration();
        expect(c.parseInlineToolCalls).toBe(true);
        vi.unstubAllEnvs();
    });

    it('falls back to false for an invalid parseInlineToolCalls env value', () => {
        vi.stubEnv('LLM_CHAT_PARSE_INLINE_TOOL_CALLS', 'invalid');
        const c = new ChatServiceConfiguration();
        expect(c.parseInlineToolCalls).toBe(false);
        vi.unstubAllEnvs();
    });

    it('defaults inlineToolCallMarkers to <tool_call>/</tool_call>', () => {
        expect(config.inlineToolCallMarkers).toEqual({
            open: '<tool_call>',
            close: '</tool_call>'
        });
    });

    it('allows overriding inlineToolCallMarkers', () => {
        const c = new ChatServiceConfiguration();
        c.inlineToolCallMarkers = {
            open: '[tool]',
            close: '[/tool]'
        };
        expect(c.inlineToolCallMarkers).toEqual({
            open: '[tool]',
            close: '[/tool]'
        });
    });
});
