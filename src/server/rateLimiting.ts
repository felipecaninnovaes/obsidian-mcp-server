/**
 * Rate limiting for authentication failures.
 * Extracted to a separate module for testability.
 */

import { MAX_AUTH_FAILURES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_CLEANUP_MS } from "../constants";

// Re-export constants that tests import directly from this module.
export { MAX_AUTH_FAILURES };
export const WINDOW_MS = RATE_LIMIT_WINDOW_MS;
export const CLEANUP_MS = RATE_LIMIT_CLEANUP_MS;

const authFailures = new Map<string, { count: number; resetAt: number }>();

export function isRateLimited(ip: string): boolean {
	const now = Date.now();
	const entry = authFailures.get(ip);
	if (!entry || now > entry.resetAt) return false;
	return entry.count >= MAX_AUTH_FAILURES;
}

export function recordAuthFailure(ip: string): void {
	const now = Date.now();
	const entry = authFailures.get(ip);
	if (!entry || now > entry.resetAt) {
		authFailures.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
	} else {
		entry.count++;
	}
}

export function cleanupExpiredEntries(): void {
	const now = Date.now();
	for (const [ip, entry] of authFailures) {
		if (now > entry.resetAt) authFailures.delete(ip);
	}
}

/** Only for use in tests — resets the shared rate limit state. */
export function resetRateLimitState(): void {
	authFailures.clear();
}

// ── Per-session request rate limiter ─────────────────────────────────────────

/**
 * Sliding-window rate limiter scoped to individual MCP sessions.
 * Maintains a list of request timestamps per session and evicts those
 * outside the window on every check.
 *
 * Default: 120 requests per 60-second window.
 */
export class SessionRateLimiter {
	static readonly WINDOW_MS = 60_000;   // 60 s sliding window
	static readonly MAX_REQUESTS = 120;   // requests allowed per window

	private readonly windows = new Map<string, number[]>();

	/**
	 * Records a new request for `sessionId` and returns whether it is allowed.
	 * Returns `false` (rate-limited) when the count in the last WINDOW_MS
	 * exceeds MAX_REQUESTS.
	 */
	check(sessionId: string, now = Date.now()): boolean {
		const cutoff = now - SessionRateLimiter.WINDOW_MS;
		let timestamps = this.windows.get(sessionId) ?? [];
		// Evict timestamps outside the window
		timestamps = timestamps.filter((t) => t > cutoff);
		timestamps.push(now);
		this.windows.set(sessionId, timestamps);
		return timestamps.length <= SessionRateLimiter.MAX_REQUESTS;
	}

	/** Remove a session's window when the session closes. */
	evict(sessionId: string): void {
		this.windows.delete(sessionId);
	}

	/** Current request count within the active window (for testing). */
	count(sessionId: string, now = Date.now()): number {
		const cutoff = now - SessionRateLimiter.WINDOW_MS;
		return (this.windows.get(sessionId) ?? []).filter((t) => t > cutoff).length;
	}
}
