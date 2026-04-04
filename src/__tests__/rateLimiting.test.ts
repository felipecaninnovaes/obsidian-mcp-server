import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	isRateLimited,
	recordAuthFailure,
	resetRateLimitState,
	MAX_AUTH_FAILURES,
	WINDOW_MS,
} from "../server/rateLimiting";

describe("rate limiting", () => {
	beforeEach(() => {
		resetRateLimitState();
		vi.useRealTimers();
	});

	it("fresh IP is not rate limited", () => {
		expect(isRateLimited("1.2.3.4")).toBe(false);
	});

	it("is not rate limited below the threshold", () => {
		for (let i = 0; i < MAX_AUTH_FAILURES - 1; i++) {
			recordAuthFailure("1.2.3.4");
		}
		expect(isRateLimited("1.2.3.4")).toBe(false);
	});

	it("is rate limited after reaching MAX_AUTH_FAILURES", () => {
		for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
			recordAuthFailure("1.2.3.4");
		}
		expect(isRateLimited("1.2.3.4")).toBe(true);
	});

	it("different IPs are tracked independently", () => {
		for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
			recordAuthFailure("1.2.3.4");
		}
		expect(isRateLimited("1.2.3.4")).toBe(true);
		expect(isRateLimited("5.6.7.8")).toBe(false);
	});

	it("resets after the time window expires", () => {
		vi.useFakeTimers();
		for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
			recordAuthFailure("1.2.3.4");
		}
		expect(isRateLimited("1.2.3.4")).toBe(true);

		vi.advanceTimersByTime(WINDOW_MS + 1);

		expect(isRateLimited("1.2.3.4")).toBe(false);
	});

	it("resets failure count after window expires on next failure", () => {
		vi.useFakeTimers();
		for (let i = 0; i < MAX_AUTH_FAILURES; i++) {
			recordAuthFailure("1.2.3.4");
		}
		vi.advanceTimersByTime(WINDOW_MS + 1);

		// New failure starts a fresh window
		recordAuthFailure("1.2.3.4");
		expect(isRateLimited("1.2.3.4")).toBe(false);
	});
});
