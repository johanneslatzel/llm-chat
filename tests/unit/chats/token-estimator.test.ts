import { describe, it, expect } from 'vitest';
import { CharCountEstimator, type TokenEstimator } from '../../../src/index.js';

class CustomEstimator implements TokenEstimator {
    estimate(text: string): number {
        return text.length === 0 ? 0 : text.split(/\s+/).length;
    }
}

describe('CharCountEstimator', () => {
    it('returns chars / 4 by default', () => {
        const est = new CharCountEstimator();
        expect(est.estimate('hello')).toBe(2);
        expect(est.estimate('')).toBe(0);
        expect(est.estimate('a')).toBe(1);
        expect(est.estimate('abcd')).toBe(1);
        expect(est.estimate('abcde')).toBe(2);
    });

    it('accepts a custom charsPerToken', () => {
        const est = new CharCountEstimator(2);
        expect(est.estimate('hello')).toBe(3);
        expect(est.estimate('ab')).toBe(1);
    });

    it('throws when charsPerToken is 0 or negative', () => {
        expect(() => new CharCountEstimator(0)).toThrow('charsPerToken must be greater than 0');
        expect(() => new CharCountEstimator(-1)).toThrow('charsPerToken must be greater than 0');
    });

    it('handles unicode characters', () => {
        const est = new CharCountEstimator();
        expect(est.estimate('你好世界')).toBe(1);
    });

    it('handles very long strings', () => {
        const est = new CharCountEstimator(4);
        expect(est.estimate('x'.repeat(1000))).toBe(250);
        expect(est.estimate('x'.repeat(1001))).toBe(251);
    });
});

describe('TokenEstimator interface', () => {
    it('works with custom implementations', () => {
        const est = new CustomEstimator();
        expect(est.estimate('hello world foo')).toBe(3);
        expect(est.estimate('')).toBe(0);
    });
});
