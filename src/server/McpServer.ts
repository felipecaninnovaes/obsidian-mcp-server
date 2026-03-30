import { App } from "obsidian";
import { McpServerSettings } from "../types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index";
import * as http from "http";

export class ObsidianMcpServer {
	private app: App;
	private settings: McpServerSettings;
	private httpServer: http.Server | null = null;
	private mcpServer: McpServer | null = null;
	private transport: StreamableHTTPServerTransport | null = null;
	private running = false;

	constructor(app: App, settings: McpServerSettings) {
		this.app = app;
		this.settings = settings;
	}

	isRunning(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
		this.mcpServer = new McpServer({
			name: "obsidian-mcp-server",
			version: "1.0.0",
		});

		registerTools(this.mcpServer, this.app);

		this.transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => Math.random().toString(36).slice(2),
		});

		await this.mcpServer.connect(this.transport);

		this.httpServer = http.createServer(async (req, res) => {
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
			res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			if (this.settings.enableAuth) {
				const authHeader = req.headers["authorization"];
				if (authHeader !== `Bearer ${this.settings.apiKey}`) {
					res.writeHead(401, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Unauthorized" }));
					return;
				}
			}

			if (req.url === "/health" || req.url === "/") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					status: "ok",
					plugin: "obsidian-mcp-server",
					version: "1.0.0",
					vault: this.app.vault.getName(),
				}));
				return;
			}

			if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
				await this.transport!.handleRequest(req, res);
				return;
			}

			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Not Found" }));
		});

		const bindHost = this.settings.networkAccess ? "0.0.0.0" : "127.0.0.1";

		await new Promise<void>((resolve, reject) => {
			this.httpServer!.listen(this.settings.port, bindHost, () => {
				console.log(`[MCP Server] Listening on http://${bindHost}:${this.settings.port}/mcp`);
				resolve();
			});
			this.httpServer!.on("error", reject);
		});

		this.running = true;
	}

	async stop(): Promise<void> {
		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve());
			});
			this.httpServer = null;
		}

		if (this.mcpServer) {
			await this.mcpServer.close();
			this.mcpServer = null;
		}

		this.transport = null;
		this.running = false;
	}
}
