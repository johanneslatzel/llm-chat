import { describe, it, expect, vi } from 'vitest';
import { envInt, envFloat, envString, envOptionalString, envBool } from '../../src/env.js';

describe('envInt', () => {
    it('returns the parsed integer when env var is set', () => {
        vi.stubEnv('TEST_INT', '42');
        expect(envInt('TEST_INT', 10)).toBe(42);
        vi.unstubAllEnvs();
    });

    it('returns max(min, fallback) when env var is empty', () => {
        vi.stubEnv('TEST_INT', '');
        expect(envInt('TEST_INT', 5, 3)).toBe(5);
        vi.unstubAllEnvs();
    });

    it('returns max(min, fallback) when env var is unset', () => {
        expect(envInt('MISSING_INT', 5, 3)).toBe(5);
    });

    it('returns max(min, fallback) when env var is NaN', () => {
        vi.stubEnv('TEST_INT', 'not-a-number');
        expect(envInt('TEST_INT', 5, 3)).toBe(5);
        vi.unstubAllEnvs();
    });
});

describe('envFloat', () => {
    it('returns the parsed float when env var is set', () => {
        vi.stubEnv('TEST_FLOAT', '3.14');
        expect(envFloat('TEST_FLOAT', 0)).toBe(3.14);
        vi.unstubAllEnvs();
    });

    it('returns fallback when env var is empty and no min', () => {
        vi.stubEnv('TEST_FLOAT', '');
        expect(envFloat('TEST_FLOAT', 2.5)).toBe(2.5);
        vi.unstubAllEnvs();
    });

    it('returns max(min, fallback) when env var is empty and min is set', () => {
        vi.stubEnv('TEST_FLOAT', '');
        expect(envFloat('TEST_FLOAT', 1.5, 5)).toBe(5);
        vi.unstubAllEnvs();
    });

    it('returns fallback when env var is unset and no min', () => {
        expect(envFloat('MISSING_FLOAT', 2.5)).toBe(2.5);
    });

    it('returns max(min, fallback) when env var is unset and min is set', () => {
        expect(envFloat('MISSING_FLOAT', 1.5, 5)).toBe(5);
    });

    it('returns fallback when env var is NaN and no min', () => {
        vi.stubEnv('TEST_FLOAT', 'not-a-float');
        expect(envFloat('TEST_FLOAT', 2.5)).toBe(2.5);
        vi.unstubAllEnvs();
    });

    it('returns max(min, fallback) when env var is NaN and min is set', () => {
        vi.stubEnv('TEST_FLOAT', 'not-a-float');
        expect(envFloat('TEST_FLOAT', 1.5, 5)).toBe(5);
        vi.unstubAllEnvs();
    });

    it('returns parsed value clamped to min', () => {
        vi.stubEnv('TEST_FLOAT', '0.5');
        expect(envFloat('TEST_FLOAT', 10, 3)).toBe(3);
        vi.unstubAllEnvs();
    });
});

describe('envString', () => {
    it('returns the env var value when set', () => {
        vi.stubEnv('TEST_STR', 'hello');
        expect(envString('TEST_STR', 'fallback')).toBe('hello');
        vi.unstubAllEnvs();
    });

    it('returns fallback when env var is unset', () => {
        expect(envString('MISSING_STR', 'fallback')).toBe('fallback');
    });
});

describe('envOptionalString', () => {
    it('returns the env var value when set', () => {
        vi.stubEnv('TEST_OPT', 'my-value');
        expect(envOptionalString('TEST_OPT')).toBe('my-value');
        vi.unstubAllEnvs();
    });

    it('returns undefined when env var is unset', () => {
        expect(envOptionalString('MISSING_OPT')).toBeUndefined();
    });

    it('returns undefined when env var is empty string', () => {
        vi.stubEnv('TEST_OPT', '');
        expect(envOptionalString('TEST_OPT')).toBeUndefined();
        vi.unstubAllEnvs();
    });

    it('returns undefined when env var is whitespace-only', () => {
        vi.stubEnv('TEST_OPT', '   ');
        expect(envOptionalString('TEST_OPT')).toBeUndefined();
        vi.unstubAllEnvs();
    });
});

describe('envBool', () => {
    it('returns true for "true"', () => {
        vi.stubEnv('TEST_BOOL', 'true');
        expect(envBool('TEST_BOOL', false)).toBe(true);
        vi.unstubAllEnvs();
    });

    it('returns true for "1"', () => {
        vi.stubEnv('TEST_BOOL', '1');
        expect(envBool('TEST_BOOL', false)).toBe(true);
        vi.unstubAllEnvs();
    });

    it('returns false for "false"', () => {
        vi.stubEnv('TEST_BOOL', 'false');
        expect(envBool('TEST_BOOL', true)).toBe(false);
        vi.unstubAllEnvs();
    });

    it('returns false for "0"', () => {
        vi.stubEnv('TEST_BOOL', '0');
        expect(envBool('TEST_BOOL', true)).toBe(false);
        vi.unstubAllEnvs();
    });

    it('returns the fallback when the env var is unset', () => {
        expect(envBool('MISSING_BOOL', true)).toBe(true);
    });

    it('returns the fallback when the env var is empty', () => {
        vi.stubEnv('TEST_BOOL', '');
        expect(envBool('TEST_BOOL', true)).toBe(true);
        vi.unstubAllEnvs();
    });

    it('returns the fallback for an unrecognised value', () => {
        vi.stubEnv('TEST_BOOL', 'maybe');
        expect(envBool('TEST_BOOL', false)).toBe(false);
        vi.unstubAllEnvs();
    });
});
