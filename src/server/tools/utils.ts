/**
 * Pure utility functions — no Obsidian dependency, fully testable.
 */

import { MAX_PATH_LENGTH as _MAX_PATH_LENGTH } from "../../constants";
import type { Permissions } from "../../types";

// Re-export so existing imports from this file continue to work.
export { MAX_PATH_LENGTH } from "../../constants";

/**
 * Validates and normalizes a vault-relative path.
 * Rejects absolute paths, path traversal sequences, and paths that are too long.
 */
export function sanitizePath(path: string): string {
	if (path.length > _MAX_PATH_LENGTH) {
		throw new Error("Path too long (max 512 characters)");
	}
	// Reject absolute paths and any traversal attempts
	if (path.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(path)) {
		throw new Error("Invalid path: absolute paths and directory traversal are not allowed");
	}
	// Normalize separators and collapse redundant segments
	const normalized = path
		.replace(/\\/g, "/")
		.split("/")
		.filter((segment) => segment.length > 0 && segment !== ".")
		.join("/");
	if (normalized.length === 0) {
		throw new Error("Invalid path: empty after normalization");
	}
	
	// BLOCK hidden obsidian/git/trash directories for security (Prevents RCE via plugin overrides)
	const firstSegment = normalized.split("/")[0]?.toLowerCase();
	// eslint-disable-next-line obsidianmd/hardcoded-config-path
	if (firstSegment === ".obsidian" || firstSegment === ".git" || firstSegment === ".trash") {
		throw new Error(`Invalid path: accessing '${firstSegment}' is not allowed for security reasons`);
	}

	return normalized;
}

/**
 * Throws if the server is configured as read-only.
 * Call at the top of every write-operation tool handler.
 */
export function assertWritePermission(permissions: Permissions): void {
	if (permissions === "read-only") {
		throw new Error("Operação não permitida: servidor em modo read-only");
	}
}

/**
 * Applies a find-and-replace edit to file content.
 * Throws if the text is not found or if the occurrence count doesn't match expectations.
 */
export function applyTextEdit(
	content: string,
	oldText: string,
	newText: string,
	expectedOccurrences: number
): { content: string; count: number } {
	let count = 0;
	let pos = 0;
	while ((pos = content.indexOf(oldText, pos)) !== -1) {
		count++;
		pos += oldText.length;
	}

	if (count === 0) {
		throw new Error("Texto não encontrado na nota");
	}
	if (count !== expectedOccurrences) {
		throw new Error(
			`Esperado ${expectedOccurrences} ocorrência(s), mas encontrado ${count}. ` +
			`Passe expected_occurrences: ${count} para confirmar a substituição.`
		);
	}

	return { content: content.split(oldText).join(newText), count };
}
