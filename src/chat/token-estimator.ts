/** Strategy for estimating the number of tokens a text string represents. */
export interface TokenEstimator {
    /** Estimate the number of tokens in the given text. */
    estimate(text: string): number;
}

/**
 * Token estimator that divides character count by a configurable chars-per-token ratio.
 * The default ratio of 4 chars/token is a reasonable approximation for most LLMs.
 * Useful as a lightweight default when a proper tokenizer is unavailable or too slow.
 */
export class CharCountEstimator implements TokenEstimator {
    /**
     * @param charsPerToken - Number of characters that equal one token (default: 4). Must be > 0.
     */
    constructor(private charsPerToken: number = 4) {
        if (charsPerToken <= 0) {
            throw new Error('charsPerToken must be greater than 0');
        }
    }

    estimate(text: string): number {
        return Math.ceil(text.length / this.charsPerToken);
    }
}
