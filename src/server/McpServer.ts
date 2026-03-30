import { App } from "obsidian";
import { McpServerSettings } from "../types";

export class ObsidianMcpServer {
	private app: App;
	private settings: McpServerSettings;
	private running = false;

	constructor(app: App, settings: McpServerSettings) {
		this.app = app;
		this.settings = settings;
	}

	isRunning(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
		// TODO: iniciar HTTP server com Streamable HTTP transport do MCP SDK
		// - criar McpServer do @modelcontextprotocol/sdk
		// - registrar tools via registerTools(mcpServer, this.app)
		// - criar http.createServer que roteia POST /mcp e GET /mcp
		// - aplicar autenticação via apiKey se settings.enableAuth
		this.running = true;
	}

	async stop(): Promise<void> {
		// TODO: encerrar o http.Server e o McpServer transport
		this.running = false;
	}
}
