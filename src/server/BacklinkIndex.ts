import { App } from "obsidian";

/**
 * Reverse-link index: maps target note path → set of source note paths that link to it.
 *
 * Maintains a forward index (source → targets) to enable O(tokens_do_arquivo) removal
 * instead of scanning the entire reverse map.
 *
 * Usage:
 *   const bl = new BacklinkIndex();
 *   bl.build(app);              // once on load
 *   bl.getBacklinks("note.md"); // O(1)
 */
export class BacklinkIndex {
	/** target path → set of source paths that link to it */
	private readonly reverseLinks = new Map<string, Set<string>>();
	/** source path → set of target paths it links to (for O(1) removal) */
	private readonly forwardLinks = new Map<string, Set<string>>();
	private built = false;

	isBuilt(): boolean {
		return this.built;
	}

	/** Build index from Obsidian's resolved link cache. */
	build(app: App): void {
		this.reverseLinks.clear();
		this.forwardLinks.clear();
		const resolvedLinks = app.metadataCache.resolvedLinks;
		for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
			for (const targetPath of Object.keys(links)) {
				this.addLink(sourcePath, targetPath);
			}
		}
		this.built = true;
	}

	/**
	 * Refresh a single source file's outgoing links.
	 * Call on vault modify/create/rename events.
	 */
	update(sourcePath: string, app: App): void {
		this.removeSource(sourcePath);
		const links = app.metadataCache.resolvedLinks[sourcePath] ?? {};
		for (const targetPath of Object.keys(links)) {
			this.addLink(sourcePath, targetPath);
		}
	}

	/**
	 * Remove a file entirely from both indexes.
	 * Call on vault delete/rename (old path) events.
	 */
	removeFile(path: string): void {
		this.removeSource(path);
		this.reverseLinks.delete(path);
	}

	/** Returns the set of paths that link to targetPath. O(1). */
	getBacklinks(targetPath: string): Set<string> {
		return this.reverseLinks.get(targetPath) ?? new Set();
	}

	/** Returns the set of paths that sourcePath links to. O(1). */
	getOutgoing(sourcePath: string): Set<string> {
		return this.forwardLinks.get(sourcePath) ?? new Set();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	private addLink(sourcePath: string, targetPath: string): void {
		// Forward
		let fwd = this.forwardLinks.get(sourcePath);
		if (!fwd) { fwd = new Set(); this.forwardLinks.set(sourcePath, fwd); }
		fwd.add(targetPath);

		// Reverse
		let rev = this.reverseLinks.get(targetPath);
		if (!rev) { rev = new Set(); this.reverseLinks.set(targetPath, rev); }
		rev.add(sourcePath);
	}

	private removeSource(sourcePath: string): void {
		const targets = this.forwardLinks.get(sourcePath);
		if (!targets) return;
		for (const target of targets) {
			this.reverseLinks.get(target)?.delete(sourcePath);
		}
		this.forwardLinks.delete(sourcePath);
	}
}
