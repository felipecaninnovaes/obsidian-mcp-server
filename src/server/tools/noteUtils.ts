/** Obsidian-dependent helpers shared across tool modules. */

import { App, TFile } from "obsidian";

/**
 * Resolves a vault path to a TFile, auto-appending ".md" when the path has no
 * extension and the bare path is not found. LLMs commonly omit the extension.
 */
export function resolveNoteFile(app: App, safePath: string): TFile | null {
	const direct = app.vault.getAbstractFileByPath(safePath);
	if (direct instanceof TFile) return direct;
	if (!/\.[^/]+$/.test(safePath)) {
		const withMd = app.vault.getAbstractFileByPath(safePath + ".md");
		if (withMd instanceof TFile) return withMd;
	}
	return null;
}
