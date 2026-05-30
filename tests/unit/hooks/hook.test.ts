import { describe, it, expect } from 'vitest';
import { Hook } from '../../../src/index.js';

describe('Hook', () => {
    it('can be extended by a concrete subclass', () => {
        let disposed = false;
        class TestHook extends Hook {
            protected onDispose(): void {
                disposed = true;
            }
        }
        const hook = new TestHook();
        expect(hook).toBeInstanceOf(Hook);
        hook.dispose();
        expect(disposed).toBe(true);
    });

    it('is exported from the barrel', () => {
        expect(Hook).toBeDefined();
    });
});
