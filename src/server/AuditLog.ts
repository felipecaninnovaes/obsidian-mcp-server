/**
 * Circular in-memory audit log for write operations.
 *
 * Keeps the last MAX_ENTRIES entries. Oldest entries are evicted when the
 * buffer is full. No disk persistence — entries are lost on plugin reload.
 */

export interface AuditEntry {
	/** Unix timestamp (ms). */
	timestamp: number;
	/** Session ID that performed the operation. */
	sessionId: string;
	/** MCP tool name (e.g. "create_note"). */
	tool: string;
	/** Truncated JSON representation of the input parameters. */
	params_summary: string;
	/** Whether the tool call succeeded. */
	result: "ok" | "error";
	/** Optional error message when result is "error". */
	error?: string;
}

export class AuditLog {
	static readonly MAX_ENTRIES = 500;

	private entries: AuditEntry[] = [];

	record(entry: AuditEntry): void {
		this.entries.push(entry);
		if (this.entries.length > AuditLog.MAX_ENTRIES) {
			this.entries = this.entries.slice(-AuditLog.MAX_ENTRIES);
		}
	}

	/**
	 * Returns up to `limit` most recent entries, optionally filtered by tool name.
	 * Always newest-first.
	 */
	getRecent(limit = 50, tool?: string): AuditEntry[] {
		const filtered = tool
			? this.entries.filter((e) => e.tool === tool)
			: this.entries;
		return filtered.slice(-limit).reverse();
	}

	get size(): number {
		return this.entries.length;
	}

	/** Only for tests — resets state. */
	clear(): void {
		this.entries = [];
	}
}

/**
 * Truncates a JSON-serialized params object to at most 200 characters.
 * Safe to call with any input — falls back to "[unserializable]" on error.
 */
export function summarizeParams(params: Record<string, unknown>): string {
	try {
		const json = JSON.stringify(params);
		return json.length <= 200 ? json : json.slice(0, 197) + "...";
	} catch {
		return "[unserializable]";
	}
}
