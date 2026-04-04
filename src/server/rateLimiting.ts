/**
 * Rate limiting for authentication failures.
 * Extracted to a separate module for testability.
 */

export const MAX_AUTH_FAILURES = 10;
export const WINDOW_MS = 60_000; // 1 minute

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
		authFailures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
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
