/** Obsidian-dependent helpers shared across tool modules. */

import { App, TFile } from "obsidian";
import { sanitizePath } from "./utils";

/**
 * Resolves a vault path to a TFile using a three-step strategy:
 *
 * 1. **Exact match** — `safePath` as-is.
 * 2. **Auto-.md** — appends `.md` when the path has no extension (LLMs often omit it).
 * 3. **Prefix match** — when the LLM truncates a path at a space (e.g. "Folder/01"
 *    instead of "Folder/01 - Title.md"), search the parent folder for files whose
 *    basename starts with the given prefix. Returns the match only when it is
 *    **unambiguous** (exactly one candidate).
 */
export function resolveNoteFile(app: App, safePath: string): TFile | null {
	// 1. Exact match
	const direct = app.vault.getAbstractFileByPath(safePath);
	if (direct instanceof TFile) return direct;

	// 2. Auto-append .md when no extension is present
	if (!/\.[^/]+$/.test(safePath)) {
		const withMd = app.vault.getAbstractFileByPath(safePath + ".md");
		if (withMd instanceof TFile) return withMd;
	}

	// 3. Prefix match within the same parent folder.
	// Handles the case where LLMs truncate paths at spaces, e.g. providing
	// "Folder/01" when the actual file is "Folder/01 - Note Title.md".
	const lastSlash = safePath.lastIndexOf("/");
	const parentPath = lastSlash >= 0 ? safePath.slice(0, lastSlash) : null;
	const prefix = lastSlash >= 0 ? safePath.slice(lastSlash + 1) : safePath;

	if (prefix.length > 0) {
		const candidates = app.vault.getMarkdownFiles().filter((f) => {
			const fSlash = f.path.lastIndexOf("/");
			const fParent = fSlash >= 0 ? f.path.slice(0, fSlash) : null;
			return fParent === parentPath && f.basename.startsWith(prefix);
		});
		if (candidates.length === 1) return candidates[0]!;
	}

	return null;
}

/**
 * Normalizes a note path by sanitizing it and ensuring it has a .md extension.
 * Helps prevent saving non-markdown files by accident.
 */
export function normalizeNotePath(path: string): string {
	const safePath = sanitizePath(path);
	if (!/\.[^/]+$/.test(safePath)) {
		return safePath + ".md";
	}
	return safePath;
}
