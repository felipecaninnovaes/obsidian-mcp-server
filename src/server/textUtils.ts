/** Text processing utilities shared across search and indexing. */

/** Splits text into lowercase tokens of 2+ characters, deduplicates. */
export function extractTokens(text: string): string[] {
	const tokens = new Set<string>();
	for (const word of text.split(/[\s\p{P}]+/u)) {
		if (word.length >= 2) tokens.add(word.toLowerCase());
	}
	return Array.from(tokens);
}
