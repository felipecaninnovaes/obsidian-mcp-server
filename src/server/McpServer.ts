import { App } from "obsidian";
import { McpServerSettings } from "../types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index";
import * as http from "http";

interface Session {
	server: McpServer;
	transport: StreamableHTTPServerTransport;
}

export class ObsidianMcpServer {
	private app: App;
	private settings: McpServerSettings;
	private httpServer: http.Server | null = null;
	private sessions = new Map<string, Session>();
	private running = false;

	constructor(app: App, settings: McpServerSettings) {
		this.app = app;
		this.settings = settings;
	}

	isRunning(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
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
					activeSessions: this.sessions.size,
				}));
				return;
			}

			if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
				await this.handleMcpRequest(req, res);
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

	private async handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		// Route to existing session
		if (sessionId && this.sessions.has(sessionId)) {
			await this.sessions.get(sessionId)!.transport.handleRequest(req, res);
			return;
		}

		// DELETE with unknown session — nothing to do
		if (req.method === "DELETE") {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Session not found" }));
			return;
		}

		// New session: only POST (initialize) is valid
		if (req.method !== "POST") {
			res.writeHead(400, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "New session must start with a POST initialize request" }));
			return;
		}

		const sid = Math.random().toString(36).slice(2);

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => sid,
		});

		const server = new McpServer({
			name: "obsidian-mcp-server",
			version: "1.0.0",
		});

		registerTools(server, this.app);
		await server.connect(transport);

		this.sessions.set(sid, { server, transport });
		console.log(`[MCP Server] Session created: ${sid} (total: ${this.sessions.size})`);

		transport.onclose = () => {
			this.sessions.delete(sid);
			server.close().catch(() => {});
			console.log(`[MCP Server] Session closed: ${sid} (total: ${this.sessions.size})`);
		};

		await transport.handleRequest(req, res);
	}

	async stop(): Promise<void> {
		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve());
			});
			this.httpServer = null;
		}

		for (const { server, transport } of this.sessions.values()) {
			transport.onclose = undefined;
			await server.close().catch(() => {});
			await transport.close().catch(() => {});
		}
		this.sessions.clear();

		this.running = false;
	}
}
