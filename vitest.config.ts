import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        pool: 'forks',
        include: ['tests/**/*.test.{ts,tsx}'],
        exclude: ['dist/**', 'node_modules/**', '.opencode/**', 'src/client/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: ['src/**/*.ts'],
            exclude: [],
            reportOnFailure: true,
            thresholds: {
                statements: 95,
                branches: 95,
                functions: 100,
                lines: 97
            },
        },
    },
});
