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
