import { App, TFolder } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, assertWritePermission, MAX_PATH_LENGTH } from "./utils";
import { resolveNoteFile } from "./noteUtils";
import { summarizeParams } from "../AuditLog";
import { DeleteLog } from "../DeleteLog";
import type { ToolDependencies } from "./index";

export function registerMetadataTools(server: McpServer, app: App, deps: ToolDependencies): void {
	const { deleteLog, permissions, auditLog, sessionId } = deps;
	registerGetNoteMetadata(server, app);
	registerListTags(server, app);
	registerGetNoteLinks(server, app);
	registerGetBacklinks(server, app);
	registerUpdateNoteMetadata(server, app, permissions, auditLog, sessionId);
	registerGetVaultContext(server, app);
	registerGetVaultChanges(server, app, deleteLog);
	registerGetAuditLog(server, auditLog);
}

function registerGetNoteMetadata(server: McpServer, app: App): void {
	server.registerTool(
		"get_note_metadata",
		{
			description: "Retorna o frontmatter (metadados YAML) de uma nota como JSON, usando o cache do Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota (ex: Pasta/Nota.md)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			const cache = app.metadataCache.getFileCache(file);
			const frontmatter = cache?.frontmatter;
			let metadata: Record<string, unknown> | null = null;
			if (frontmatter) {
				// Exclude Obsidian's internal 'position' key from the result
				metadata = Object.fromEntries(
					Object.entries(frontmatter).filter(([k]) => k !== "position")
				);
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ path: safePath, frontmatter: metadata }, null, 2) }],
			};
		}
	);
}

function registerListTags(server: McpServer, app: App): void {
	server.registerTool(
		"list_tags",
		{
			description: "Lista todas as tags do vault com contagem de ocorrências, usando o cache do Obsidian.",
		},
		async () => {
			const tagCounts = new Map<string, number>();
			for (const file of app.vault.getMarkdownFiles()) {
				const cache = app.metadataCache.getFileCache(file);
				// Inline tags (e.g. #tag in body)
				for (const { tag } of cache?.tags ?? []) {
					tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
				}
				// Frontmatter tags (e.g. tags: [foo, bar])
				const fmTags: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTags)) {
					for (const t of fmTags) {
						if (typeof t === "string") {
							const normalized = t.startsWith("#") ? t : `#${t}`;
							tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
						}
					}
				}
			}
			const tags = Array.from(tagCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.map(([tag, count]) => ({ tag, count }));
			return {
				content: [{ type: "text", text: JSON.stringify({ total_tags: tags.length, tags }, null, 2) }],
			};
		}
	);
}

function registerGetNoteLinks(server: McpServer, app: App): void {
	server.registerTool(
		"get_note_links",
		{
			description: "Retorna os links de saída (outgoing links) de uma nota, usando o cache do Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota (ex: Pasta/Nota.md)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			const cache = app.metadataCache.getFileCache(file);

			const links = (cache?.links ?? []).map((l) => ({
				link: l.link,
				display: l.displayText ?? l.link,
				resolved: app.metadataCache.getFirstLinkpathDest(l.link, safePath)?.path ?? null,
			}));

			const frontmatterLinks = (cache?.frontmatterLinks ?? []).map((l) => ({
				link: l.link,
				display: l.displayText ?? l.link,
				key: l.key,
				resolved: app.metadataCache.getFirstLinkpathDest(l.link, safePath)?.path ?? null,
			}));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ path: safePath, total: links.length + frontmatterLinks.length, links, frontmatter_links: frontmatterLinks },
							null,
							2
						),
					},
				],
			};
		}
	);
}

function registerGetBacklinks(server: McpServer, app: App): void {
	server.registerTool(
		"get_backlinks",
		{
			description: "Lista todas as notas que contêm links apontando para uma nota específica.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota alvo (ex: Termos/Glossário.md)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const target = resolveNoteFile(app, safePath);
			if (!target) throw new Error("Arquivo não encontrado");

			// Use metadataCache.resolvedLinks for O(n) index lookup instead of scanning file content
			const resolvedLinks = app.metadataCache.resolvedLinks;
			const backlinks: string[] = [];
			for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
				if (sourcePath === safePath) continue;
				if (links[safePath]) backlinks.push(sourcePath);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ target: safePath, total: backlinks.length, backlinks: backlinks.sort() }, null, 2),
					},
				],
			};
		}
	);
}

// ── update_note_metadata ──────────────────────────────────────────────────────

/** Regex to detect and capture the frontmatter block at the start of a file. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function registerUpdateNoteMetadata(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
	server.registerTool(
		"update_note_metadata",
		{
			description:
				"Atualiza o frontmatter YAML de uma nota de forma atômica. " +
				"Use 'set' para adicionar/atualizar chaves e 'remove' para excluí-las. " +
				"Cria o bloco frontmatter se não existir e 'set' for fornecido.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota (ex: Pasta/Nota.md)"),
				set: z.record(z.string(), z.unknown()).optional().describe("Chaves a adicionar ou atualizar no frontmatter"),
				remove: z.array(z.string()).optional().describe("Chaves a remover do frontmatter"),
			},
		},
		async ({ path, set, remove }) => {
			assertWritePermission(permissions);
			if (!set && !remove?.length) {
				throw new Error("Forneça ao menos 'set' ou 'remove'");
			}

			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");

			let finalFrontmatter: Record<string, unknown> = {};

			await app.vault.process(file, (content) => {
				const match = FRONTMATTER_RE.exec(content);
				const body = match ? content.slice(match[0].length) : content;

				// Parse current frontmatter from Obsidian's cache (already parsed)
				const cached = app.metadataCache.getFileCache(file)?.frontmatter;
				const current: Record<string, unknown> = cached
					? Object.fromEntries(Object.entries(cached).filter(([k]) => k !== "position"))
					: {};

				// Apply set (merge) and remove (delete) operations
				const updated = { ...current, ...(set ?? {}) };
				for (const key of remove ?? []) {
					delete updated[key];
				}
				finalFrontmatter = updated;

				if (Object.keys(updated).length === 0) {
					// No frontmatter left — strip the block entirely
					return body;
				}

				const yamlBlock = `---\n${serializeFrontmatter(updated)}\n---\n`;
				return yamlBlock + body;
			});

			auditLog.record({ timestamp: Date.now(), sessionId, tool: "update_note_metadata", params_summary: summarizeParams({ path: safePath, set, remove }), result: "ok" });
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ path: safePath, frontmatter: finalFrontmatter }, null, 2),
					},
				],
			};
		}
	);
}

// ── get_vault_context ─────────────────────────────────────────────────────────

function registerGetVaultContext(server: McpServer, app: App): void {
	server.registerTool(
		"get_vault_context",
		{
			description:
				"Retorna uma visão geral do vault em uma única chamada: estatísticas, árvore de pastas, " +
				"top tags, notas recentes e notas mais linkadas.",
		},
		async () => {
			const markdownFiles = app.vault.getMarkdownFiles();
			const allFiles = app.vault.getAllLoadedFiles();

			// Stats
			const folders = allFiles.filter((f) => f instanceof TFolder);
			const tagCounts = collectTagCounts(app);
			const stats = {
				total_notes: markdownFiles.length,
				total_folders: folders.length,
				total_tags: tagCounts.size,
			};

			// Folder tree
			const folderTree = folders
				.map((f) => f.path + "/")
				.sort();

			// Top 20 tags by count
			const topTags = Array.from(tagCounts.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 20)
				.map(([tag, count]) => ({ tag, count }));

			// 20 most recently modified notes
			const recentNotes = [...markdownFiles]
				.sort((a, b) => b.stat.mtime - a.stat.mtime)
				.slice(0, 20)
				.map((f) => ({ path: f.path, mtime: new Date(f.stat.mtime).toISOString() }));

			// 10 most inbound-linked notes
			const inboundCount = new Map<string, number>();
			for (const links of Object.values(app.metadataCache.resolvedLinks)) {
				for (const targetPath of Object.keys(links)) {
					inboundCount.set(targetPath, (inboundCount.get(targetPath) ?? 0) + 1);
				}
			}
			const mostLinked = Array.from(inboundCount.entries())
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([path, inbound_links]) => ({ path, inbound_links }));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ stats, folder_tree: folderTree, top_tags: topTags, recent_notes: recentNotes, most_linked: mostLinked },
							null,
							2
						),
					},
				],
			};
		}
	);
}

// ── get_audit_log ─────────────────────────────────────────────────────────────

function registerGetAuditLog(server: McpServer, auditLog: ToolDependencies["auditLog"]): void {
	server.registerTool(
		"get_audit_log",
		{
			description:
				"Retorna as operações de escrita recentes registradas pelo servidor (in-memory, últimas 500). " +
				"Útil para auditar o que foi modificado na sessão atual.",
			inputSchema: {
				limit: z
					.number()
					.int()
					.min(1)
					.max(500)
					.optional()
					.default(50)
					.describe("Número máximo de entradas a retornar, mais recentes primeiro (default 50)."),
				tool: z
					.string()
					.optional()
					.describe("Filtrar por nome de tool (ex: 'create_note'). Omitir para todas."),
			},
		},
		async ({ limit, tool }) => {
			const entries = auditLog.getRecent(limit, tool);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ total: entries.length, entries }, null, 2),
					},
				],
			};
		}
	);
}

// ── Frontmatter utilities (pure, exported for testing) ────────────────────────

/**
 * Serialize a plain object as YAML frontmatter lines.
 * Handles strings, numbers, booleans, null, and arrays of primitives.
 * Nested objects are serialized as JSON strings.
 */
export function serializeFrontmatter(obj: Record<string, unknown>): string {
	return Object.entries(obj)
		.map(([key, value]) => serializeKV(key, value))
		.join("\n");
}

function serializeKV(key: string, value: unknown): string {
	if (Array.isArray(value)) {
		if (value.length === 0) return `${key}: []`;
		const items = value.map((v) => `  - ${serializePrimitive(v)}`).join("\n");
		return `${key}:\n${items}`;
	}
	return `${key}: ${serializePrimitive(value)}`;
}

function serializePrimitive(value: unknown): string {
	if (value === null || value === undefined) return "null";
	if (typeof value === "boolean") return String(value);
	if (typeof value === "number") return String(value);
	if (typeof value === "object") return JSON.stringify(value);
	const str = String(value);
	return needsYamlQuoting(str) ? JSON.stringify(str) : str;
}

function needsYamlQuoting(s: string): boolean {
	if (s.length === 0) return true;
	if (/^\s|\s$/.test(s)) return true;
	if (/[:#\[\]{}&*!|>'"%@`,]/.test(s)) return true;
	if (/\n/.test(s)) return true;
	if (["true", "false", "null", "yes", "no", "on", "off"].includes(s.toLowerCase())) return true;
	// Strings that look like numbers should be quoted to preserve them as strings
	if (s !== "" && !isNaN(Number(s))) return true;
	return false;
}

// ── get_vault_changes ─────────────────────────────────────────────────────────

function registerGetVaultChanges(server: McpServer, app: App, deleteLog: DeleteLog): void {
	server.registerTool(
		"get_vault_changes",
		{
			description:
				"Lista arquivos criados, modificados ou deletados desde uma data/hora. " +
				"Deletados são rastreados apenas nas últimas 24 horas. " +
				"Útil para sincronizar o estado do vault com ferramentas externas.",
			inputSchema: {
				since: z
					.string()
					.describe("Timestamp ISO 8601 a partir do qual buscar mudanças. Ex: \"2026-01-01T00:00:00Z\""),
				types: z
					.array(z.enum(["created", "modified", "deleted"]))
					.optional()
					.describe("Tipos de mudança a incluir (default: todos)."),
			},
		},
		async ({ since, types }) => {
			const sinceMs = new Date(since).getTime();
			if (isNaN(sinceMs)) throw new Error(`Timestamp inválido: ${since}`);

			const includeAll = !types || types.length === 0;
			const include = (t: "created" | "modified" | "deleted") =>
				includeAll || types!.includes(t);

			type ChangeEntry = { path: string; type: "created" | "modified" | "deleted"; timestamp: string };
			const changes: ChangeEntry[] = [];

			// Created & modified — iterate live files
			if (include("created") || include("modified")) {
				for (const file of app.vault.getMarkdownFiles()) {
					if (include("created") && file.stat.ctime >= sinceMs) {
						changes.push({
							path: file.path,
							type: "created",
							timestamp: new Date(file.stat.ctime).toISOString(),
						});
					} else if (include("modified") && file.stat.mtime >= sinceMs) {
						// Only emit "modified" when not also reporting as "created"
						changes.push({
							path: file.path,
							type: "modified",
							timestamp: new Date(file.stat.mtime).toISOString(),
						});
					}
				}
			}

			// Deleted — from the in-memory log (24 h retention)
			if (include("deleted")) {
				for (const entry of deleteLog.getSince(sinceMs)) {
					changes.push({
						path: entry.path,
						type: "deleted",
						timestamp: new Date(entry.timestamp).toISOString(),
					});
				}
			}

			// Sort chronologically
			changes.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ since, total: changes.length, changes }, null, 2),
					},
				],
			};
		}
	);
}

// ── Tag counting helper ───────────────────────────────────────────────────────

function collectTagCounts(app: App): Map<string, number> {
	const tagCounts = new Map<string, number>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		for (const { tag } of cache?.tags ?? []) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
		const fmTags: unknown = cache?.frontmatter?.["tags"];
		if (Array.isArray(fmTags)) {
			for (const t of fmTags) {
				if (typeof t === "string") {
					const normalized = t.startsWith("#") ? t : `#${t}`;
					tagCounts.set(normalized, (tagCounts.get(normalized) ?? 0) + 1);
				}
			}
		}
	}
	return tagCounts;
}
