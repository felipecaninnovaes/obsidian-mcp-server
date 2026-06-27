/**
 * Pure, Obsidian-free functions for search scoring and excerpt extraction.
 * Exported separately so they can be unit-tested without mocking Obsidian.
 */

import { extractTokens } from "./textUtils";

// ── TF-IDF Scoring ────────────────────────────────────────────────────────────

export interface ScoreParams {
	/** Full text of the document. */
	content: string;
	/** Query string (used lowercased for position bonus check). */
	queryLower: string;
	/** How many times the phrase/token was found in this document. */
	matchCount: number;
	/** Total number of indexed documents (N). */
	totalDocs: number;
	/** Number of documents that contain the discriminating term (df). */
	docsWithTerm: number;
	/** File last-modified timestamp in ms since epoch. */
	mtime: number;
}

/**
 * Computes a TF-IDF-based relevance score for a document.
 *
 * score = TF × IDF + position_bonus + recency_bonus
 *
 * - TF  = matchCount / unique_token_count_in_doc
 * - IDF = log((N + 1) / (df + 1)) + 1  (smoothed to avoid zero)
 * - position_bonus = +2.0 if query appears in the first line (title / H1)
 * - recency_bonus  = up to +0.3, linear decay over 90 days
 */
export function computeScore(p: ScoreParams): number {
	const docTokenCount = Math.max(1, extractTokens(p.content).length);
	const tf = p.matchCount / docTokenCount;

	// Smoothed IDF — never zero, even when totalDocs/docsWithTerm are unknown
	const idf =
		p.totalDocs > 0 && p.docsWithTerm > 0
			? Math.log((p.totalDocs + 1) / (p.docsWithTerm + 1)) + 1
			: 1;

	let score = tf * idf;

	// Position bonus: match in the very first line is title-level relevance
	const firstNewline = p.content.indexOf("\n");
	const firstLine = firstNewline === -1 ? p.content : p.content.slice(0, firstNewline);
	if (firstLine.toLowerCase().includes(p.queryLower)) score += 2.0;

	// Recency bonus: linear decay over 90 days, capped at +0.3
	const ageDays = (Date.now() - p.mtime) / 86_400_000;
	score += Math.max(0, 0.3 * (1 - ageDays / 90));

	return score;
}

// ── Smart Excerpt ─────────────────────────────────────────────────────────────

/**
 * Returns a context-rich excerpt for a search match.
 *
 * Strategy:
 * 1. Locate the paragraph (delimited by blank lines) that contains the match.
 * 2. If the paragraph exceeds 500 chars, truncate to ±200 chars around the match.
 * 3. Find the nearest Markdown heading above the match and prepend it.
 *
 * The result is a single line (newlines replaced with spaces).
 */
export function buildSmartExcerpt(
	content: string,
	matchIdx: number,
	matchLen: number
): string {
	// ── 1. Paragraph boundaries ──────────────────────────────────────────────
	// Walk backward from matchIdx to find a blank line (\n\n) or document start
	const beforeMatch = content.slice(0, matchIdx);
	const blankBefore = beforeMatch.lastIndexOf("\n\n");
	const paraStart = blankBefore === -1 ? 0 : blankBefore + 2;

	// Walk forward from end of match to find a blank line or document end
	const afterMatch = content.indexOf("\n\n", matchIdx + matchLen);
	const paraEnd = afterMatch === -1 ? content.length : afterMatch;

	let para = content.slice(paraStart, paraEnd).trim();

	// ── 2. Truncate long paragraphs ───────────────────────────────────────────
	const relIdx = matchIdx - paraStart;
	if (para.length > 500) {
		const margin = 200;
		const start = Math.max(0, relIdx - margin);
		const end = Math.min(para.length, relIdx + matchLen + margin);
		para =
			(start > 0 ? "..." : "") +
			para.slice(start, end) +
			(end < para.length ? "..." : "");
	}

	// ── 3. Parent heading ─────────────────────────────────────────────────────
	// Find the last heading (line starting with #) before the match
	const headingRe = /^#{1,6}\s+.+$/gm;
	let lastHeading: string | null = null;
	let m: RegExpExecArray | null;
	while ((m = headingRe.exec(beforeMatch)) !== null) {
		lastHeading = m[0].trim();
	}

	const excerpt = para.replace(/\n/g, " ");
	return lastHeading ? `${lastHeading} > ${excerpt}` : excerpt;
}

// ── Pagination helpers ────────────────────────────────────────────────────────

/**
 * Applies offset+limit pagination to a sorted result array.
 * Returns `{ page, total_results }` so callers can build the response.
 */
export function paginate<T>(
	items: T[],
	offset: number,
	limit: number
): { page: T[]; total_results: number } {
	return { page: items.slice(offset, offset + limit), total_results: items.length };
}
