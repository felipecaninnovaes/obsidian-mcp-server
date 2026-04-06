export type LogLevel = "debug" | "info" | "warn" | "error";

/** Controls which MCP tools are exposed to clients. */
export type Permissions = "read-only" | "read-write";

export interface McpServerSettings {
	port: number;
	apiKey: string;
	enableAuth: boolean;
	autoStart: boolean;
	networkAccess: boolean;
	logLevel: LogLevel;
	permissions: Permissions;
	/** Enable the semantic_search tool (requires embedding API configuration). */
	semanticSearch: boolean;
	/** OpenAI-compatible embeddings endpoint. E.g. https://api.openai.com/v1/embeddings */
	embeddingEndpoint: string;
	/** API key for the embedding provider. */
	embeddingApiKey: string;
	/** Embedding model name. E.g. text-embedding-3-small */
	embeddingModel: string;
}

export const DEFAULT_SETTINGS: McpServerSettings = {
	port: 27123,
	apiKey: "",
	enableAuth: true,
	autoStart: true,
	networkAccess: false,
	logLevel: "info",
	permissions: "read-write",
	semanticSearch: false,
	embeddingEndpoint: "https://api.openai.com/v1/embeddings",
	embeddingApiKey: "",
	embeddingModel: "text-embedding-3-small",
};
