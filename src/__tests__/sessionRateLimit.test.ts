import { describe, it, expect, beforeEach } from "vitest";
import { SessionRateLimiter } from "../server/rateLimiting";

describe("SessionRateLimiter", () => {
	let limiter: SessionRateLimiter;

	beforeEach(() => {
		limiter = new SessionRateLimiter();
	});

	const WINDOW = SessionRateLimiter.WINDOW_MS;
	const MAX = SessionRateLimiter.MAX_REQUESTS;

	// ── basic allow / deny ────────────────────────────────────────────────────

	it("allows the first request", () => {
		expect(limiter.check("s1")).toBe(true);
	});

	it("allows requests up to the limit", () => {
		const now = 1_000_000;
		for (let i = 0; i < MAX; i++) {
			expect(limiter.check("s1", now + i)).toBe(true);
		}
	});

	it("blocks the request at MAX + 1", () => {
		const now = 1_000_000;
		for (let i = 0; i < MAX; i++) {
			limiter.check("s1", now + i);
		}
		expect(limiter.check("s1", now + MAX)).toBe(false);
	});

	// ── sliding window ────────────────────────────────────────────────────────

	it("allows new requests after the window expires", () => {
		const base = 1_000_000;
		// Fill the window
		for (let i = 0; i < MAX; i++) {
			limiter.check("s1", base + i);
		}
		expect(limiter.check("s1", base + MAX)).toBe(false);

		// Advance time past the window — old entries are evicted
		const future = base + WINDOW + 1;
		expect(limiter.check("s1", future)).toBe(true);
	});

	it("evicts only timestamps outside the window (sliding, not fixed)", () => {
		const base = 1_000_000;
		// Make MAX - 1 requests near the start
		for (let i = 0; i < MAX - 1; i++) {
			limiter.check("s1", base + i);
		}
		// Advance to where the first batch is just inside the window
		const mid = base + WINDOW - 100;
		// This request is still within the window — should be allowed (count = MAX)
		expect(limiter.check("s1", mid)).toBe(true);
		// Next one hits MAX + 1 — blocked
		expect(limiter.check("s1", mid + 1)).toBe(false);
	});

	// ── per-session isolation ─────────────────────────────────────────────────

	it("tracks sessions independently", () => {
		const now = 1_000_000;
		// Fill session 1
		for (let i = 0; i < MAX; i++) limiter.check("s1", now + i);
		expect(limiter.check("s1", now + MAX)).toBe(false);

		// Session 2 is unaffected
		expect(limiter.check("s2", now)).toBe(true);
	});

	// ── evict ─────────────────────────────────────────────────────────────────

	it("evict() removes the session so it starts fresh", () => {
		const now = 1_000_000;
		for (let i = 0; i < MAX; i++) limiter.check("s1", now + i);
		expect(limiter.check("s1", now + MAX)).toBe(false);

		limiter.evict("s1");
		// Fresh start after eviction
		expect(limiter.check("s1", now + MAX + 1)).toBe(true);
	});

	it("evict() on unknown session is a no-op", () => {
		expect(() => limiter.evict("unknown")).not.toThrow();
	});

	// ── count ─────────────────────────────────────────────────────────────────

	it("count() returns the number of requests in the active window", () => {
		const now = 1_000_000;
		limiter.check("s1", now);
		limiter.check("s1", now + 100);
		limiter.check("s1", now + 200);
		expect(limiter.count("s1", now + 300)).toBe(3);
	});

	it("count() excludes timestamps outside the window", () => {
		const base = 1_000_000;
		// These two are just before the window boundary at (base + WINDOW + 2)
		limiter.check("s1", base);              // expires at base + WINDOW → outside at base + WINDOW + 1
		// This one is fresh
		limiter.check("s1", base + WINDOW + 1); // inside the window at base + WINDOW + 2

		// At base + WINDOW + 2: cutoff = base + 2, so base (= cutoff - 2) is excluded
		expect(limiter.count("s1", base + WINDOW + 2)).toBe(1);
	});

	it("count() returns 0 for an unknown session", () => {
		expect(limiter.count("nobody")).toBe(0);
	});

	// ── constants ─────────────────────────────────────────────────────────────

	it("WINDOW_MS is 60 seconds", () => {
		expect(SessionRateLimiter.WINDOW_MS).toBe(60_000);
	});

	it("MAX_REQUESTS is 120", () => {
		expect(SessionRateLimiter.MAX_REQUESTS).toBe(120);
	});
});
