import { App } from "obsidian";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sanitizePath } from "./utils";
import { resolveNoteFile } from "./noteUtils";

export function registerVaultResources(server: McpServer, app: App): void {
	// Static resource: list of all notes with metadata
	server.registerResource(
		"vault-notes",
		"vault://notes",
		{ description: "Lista todas as notas do vault com path, tags e frontmatter." },
		async () => {
			const files = app.vault.getMarkdownFiles();
			const notes = files.map((f) => {
				const cache = app.metadataCache.getFileCache(f);
				const tags: string[] = [];
				for (const { tag } of cache?.tags ?? []) tags.push(tag);
				const fmTagsRaw: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTagsRaw)) {
					for (const t of fmTagsRaw) {
						if (typeof t === "string") tags.push(t.startsWith("#") ? t : `#${t}`);
					}
				}
				let frontmatter: Record<string, unknown> | null = null;
				if (cache?.frontmatter) {
					frontmatter = Object.fromEntries(
						Object.entries(cache.frontmatter).filter(([k]) => k !== "position")
					);
				}
				return { path: f.path, tags, frontmatter };
			});
			return {
				contents: [
					{
						uri: "vault://notes",
						mimeType: "application/json",
						text: JSON.stringify({ total: notes.length, notes }, null, 2),
					},
				],
			};
		}
	);

	// Static resource: all tags with counts
	server.registerResource(
		"vault-tags",
		"vault://tags",
		{ description: "Índice de todas as tags do vault com contagem de ocorrências." },
		async () => {
			const tagCounts = new Map<string, number>();
			for (const f of app.vault.getMarkdownFiles()) {
				const cache = app.metadataCache.getFileCache(f);
				for (const { tag } of cache?.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
				const fmTagsRaw: unknown = cache?.frontmatter?.["tags"];
				if (Array.isArray(fmTagsRaw)) {
					for (const t of fmTagsRaw) {
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
				contents: [
					{
						uri: "vault://tags",
						mimeType: "application/json",
						text: JSON.stringify({ total_tags: tags.length, tags }, null, 2),
					},
				],
			};
		}
	);

	// Template resource: individual note content at vault://note/{+path}
	const noteTemplate = new ResourceTemplate("vault://note/{+path}", {
		list: async () => {
			const files = app.vault.getMarkdownFiles();
			return {
				resources: files.map((f) => ({
					uri: `vault://note/${f.path}`,
					name: f.basename,
					mimeType: "text/markdown",
				})),
			};
		},
	});

	server.registerResource(
		"vault-note",
		noteTemplate,
		{ description: "Conteúdo completo de uma nota específica do vault." },
		async (uri, { path }) => {
			if (typeof path !== "string" || path.length === 0) {
				throw new Error("path é obrigatório");
			}
			// {+path} template may leave reserved chars unencoded, but clients may percent-encode spaces
			const decodedPath = decodeURIComponent(path);
			const safePath = sanitizePath(decodedPath);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");
			const content = await app.vault.cachedRead(file);
			return {
				contents: [
					{
						uri: uri.toString(),
						mimeType: "text/markdown",
						text: content,
					},
				],
			};
		}
	);
}
