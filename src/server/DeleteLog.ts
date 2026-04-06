/**
 * Circular buffer that records vault delete events so that `get_vault_changes`
 * can report deleted files even though they no longer exist on disk.
 *
 * Retention policy:
 * - At most MAX_ENTRIES entries (older entries are evicted when the buffer fills).
 * - Entries older than MAX_AGE_MS are excluded from query results and pruned on
 *   each `record()` call to keep memory usage bounded.
 */
export class DeleteLog {
	private static readonly MAX_ENTRIES = 1_000;
	private static readonly MAX_AGE_MS = 24 * 60 * 60 * 1_000; // 24 hours

	private entries: Array<{ path: string; timestamp: number }> = [];

	/** Record a deletion event for the given vault-relative path. */
	record(path: string, now = Date.now()): void {
		this.prune(now);
		this.entries.push({ path, timestamp: now });
		// Evict oldest entries if the buffer is full
		if (this.entries.length > DeleteLog.MAX_ENTRIES) {
			this.entries = this.entries.slice(-DeleteLog.MAX_ENTRIES);
		}
	}

	/**
	 * Returns all deletion events that occurred at or after `sinceMs` and
	 * within the 24-hour retention window.
	 */
	getSince(sinceMs: number, now = Date.now()): Array<{ path: string; timestamp: number }> {
		const cutoff = now - DeleteLog.MAX_AGE_MS;
		return this.entries.filter(
			(e) => e.timestamp >= sinceMs && e.timestamp >= cutoff
		);
	}

	/** Remove entries outside the retention window. */
	prune(now = Date.now()): void {
		const cutoff = now - DeleteLog.MAX_AGE_MS;
		this.entries = this.entries.filter((e) => e.timestamp >= cutoff);
	}

	/** Number of entries currently stored (for testing). */
	get size(): number {
		return this.entries.length;
	}
}
