import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SemanticIndex } from "../SemanticIndex";
import { SEMANTIC_SEARCH_DEFAULT, SEMANTIC_SEARCH_MAX } from "../../constants";

export function registerSemanticSearchTools(
	server: McpServer,
	_app: App,
	semanticIndex: SemanticIndex
): void {
	server.registerTool(
		"semantic_search",
		{
			description:
				"Busca semântica por notas usando embeddings vetoriais. " +
				"Encontra notas conceitualmente relacionadas mesmo sem correspondência exata de palavras. " +
				"Os resultados são ordenados por similaridade semântica (score entre 0 e 1). " +
				"Requer que 'Semantic Search' esteja ativado e configurado nas configurações do plugin.",
			inputSchema: {
				query: z
					.string()
					.min(1)
					.max(1_000)
					.describe("Texto ou conceito para busca semântica."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(SEMANTIC_SEARCH_MAX)
					.optional()
					.default(SEMANTIC_SEARCH_DEFAULT)
					.describe(
						`Número máximo de resultados (default ${SEMANTIC_SEARCH_DEFAULT}, max ${SEMANTIC_SEARCH_MAX}).`
					),
			},
		},
		async ({ query, limit }) => {
			if (!semanticIndex.isConfigured()) {
				throw new Error(
					"Busca semântica não configurada. " +
					"Ative 'Semantic Search' e configure o endpoint de embeddings nas configurações do plugin MCP Server."
				);
			}

			const results = await semanticIndex.search(query, limit);

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{ query, total_results: results.length, results },
							null,
							2
						),
					},
				],
			};
		}
	);
}
