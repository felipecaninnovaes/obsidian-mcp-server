import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, MAX_PATH_LENGTH } from "./utils";
import { resolveNoteFile } from "./noteUtils";

export function registerMetadataTools(server: McpServer, app: App): void {
	registerGetNoteMetadata(server, app);
	registerListTags(server, app);
	registerGetNoteLinks(server, app);
	registerGetBacklinks(server, app);
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
