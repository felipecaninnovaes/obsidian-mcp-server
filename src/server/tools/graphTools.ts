import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, MAX_PATH_LENGTH } from "./utils";
import { resolveNoteFile } from "./noteUtils";

export function registerGraphTools(server: McpServer, app: App): void {
	registerGetGraphNeighbors(server, app);
	registerSuggestLinks(server, app);
}

function registerGetGraphNeighbors(server: McpServer, app: App): void {
	server.registerTool(
		"get_graph_neighbors",
		{
			description:
				"Retorna notas vizinhas no grafo de conhecimento via BFS até N graus de separação, " +
				"usando o índice de links resolvidos do Obsidian.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota de origem (ex: Pasta/Nota.md)"),
				depth: z
					.number()
					.int()
					.min(1)
					.max(3)
					.optional()
					.default(1)
					.describe("Profundidade da busca BFS (1-3, default 1)"),
				direction: z
					.enum(["outgoing", "incoming", "both"])
					.optional()
					.default("both")
					.describe("Direção dos links a seguir"),
			},
		},
		async ({ path, depth, direction }) => {
			const safePath = sanitizePath(path);
			const target = resolveNoteFile(app, safePath);
			if (!target) throw new Error("Arquivo não encontrado");

			const resolvedLinks = app.metadataCache.resolvedLinks;

			// Build reverse index (incoming links) if needed
			const incomingLinks = new Map<string, Set<string>>();
			if (direction !== "outgoing") {
				for (const [src, targets] of Object.entries(resolvedLinks)) {
					for (const dest of Object.keys(targets)) {
						let set = incomingLinks.get(dest);
						if (!set) { set = new Set(); incomingLinks.set(dest, set); }
						set.add(src);
					}
				}
			}

			const nodes = new Set<string>();
			const edges: [string, string][] = [];
			const queue: { path: string; d: number }[] = [{ path: safePath, d: 0 }];
			nodes.add(safePath);

			while (queue.length > 0) {
				const item = queue.shift()!;
				if (item.d >= depth) continue;

				const neighbors = new Set<string>();
				if (direction !== "incoming") {
					for (const dest of Object.keys(resolvedLinks[item.path] ?? {})) neighbors.add(dest);
				}
				if (direction !== "outgoing") {
					for (const src of incomingLinks.get(item.path) ?? []) neighbors.add(src);
				}

				for (const neighbor of neighbors) {
					edges.push([item.path, neighbor]);
					if (!nodes.has(neighbor)) {
						nodes.add(neighbor);
						queue.push({ path: neighbor, d: item.d + 1 });
					}
				}
			}

			// Remove origin from nodes list; return neighbors only
			nodes.delete(safePath);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								origin: safePath,
								depth,
								direction,
								total_neighbors: nodes.size,
								nodes: Array.from(nodes).sort(),
								edges,
							},
							null,
							2
						),
					},
				],
			};
		}
	);
}

function registerSuggestLinks(server: McpServer, app: App): void {
	server.registerTool(
		"suggest_links",
		{
			description:
				"Sugere notas existentes que poderiam ser linkadas a partir do conteúdo de uma nota, " +
				"comparando títulos e aliases contra o texto sem [[links]] já existentes.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho da nota a analisar (ex: Pasta/Nota.md)"),
				limit: z
					.number()
					.int()
					.min(1)
					.max(50)
					.optional()
					.default(10)
					.describe("Máximo de sugestões (default 10)"),
			},
		},
		async ({ path, limit }) => {
			const safePath = sanitizePath(path);
			const file = resolveNoteFile(app, safePath);
			if (!file) throw new Error("Arquivo não encontrado");

			const rawContent = await app.vault.cachedRead(file);

			// Strip existing [[...]] links so we don't re-suggest what's already linked
			const strippedContent = rawContent.replace(/\[\[[^\]]*\]\]/g, "");

			// Collect all candidate titles and aliases from the vault
			interface Candidate { notePath: string; term: string }
			const candidates: Candidate[] = [];
			for (const note of app.vault.getMarkdownFiles()) {
				if (note.path === safePath) continue;
				candidates.push({ notePath: note.path, term: note.basename });
				const cache = app.metadataCache.getFileCache(note);
				const aliases: unknown = cache?.frontmatter?.["aliases"];
				if (Array.isArray(aliases)) {
					for (const alias of aliases) {
						if (typeof alias === "string" && alias.length >= 2) {
							candidates.push({ notePath: note.path, term: alias });
						}
					}
				}
			}

			// Sort by term length descending so longer matches take priority
			candidates.sort((a, b) => b.term.length - a.term.length);

			const suggestions: { note: string; term: string; excerpt: string }[] = [];
			const suggestedNotes = new Set<string>();

			for (const { notePath, term } of candidates) {
				if (suggestions.length >= limit) break;
				if (suggestedNotes.has(notePath)) continue;
				if (term.length < 2) continue;

				const idx = strippedContent.toLowerCase().indexOf(term.toLowerCase());
				if (idx === -1) continue;

				const excerpt =
					"..." +
					rawContent.slice(Math.max(0, idx - 60), idx + term.length + 60).replace(/\n/g, " ") +
					"...";
				suggestions.push({ note: notePath, term, excerpt });
				suggestedNotes.add(notePath);
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({ path: safePath, total: suggestions.length, suggestions }, null, 2),
					},
				],
			};
		}
	);
}
