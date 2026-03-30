import { App } from "obsidian";
import { McpServerSettings } from "../types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerTools } from "./tools/index";
import * as http from "http";
import { randomBytes } from "crypto";

interface StreamableSession {
	server: McpServer;
	transport: StreamableHTTPServerTransport;
}

interface SseSession {
	server: McpServer;
	transport: SSEServerTransport;
}

export class ObsidianMcpServer {
	private app: App;
	private settings: McpServerSettings;
	private httpServer: http.Server | null = null;
	private sessions = new Map<string, StreamableSession>();
	private sseSessions = new Map<string, SseSession>();
	private running = false;

	constructor(app: App, settings: McpServerSettings) {
		this.app = app;
		this.settings = settings;
	}

	isRunning(): boolean {
		return this.running;
	}

	async start(): Promise<void> {
		// Runtime validation: reject invalid port numbers
		if (
			!Number.isInteger(this.settings.port) ||
			this.settings.port < 1 ||
			this.settings.port > 65535
		) {
			throw new Error(`Invalid port number: ${this.settings.port}. Must be between 1 and 65535.`);
		}

		// Enforce authentication when binding to all interfaces
		if (this.settings.networkAccess && !this.settings.enableAuth) {
			throw new Error(
				"Authentication must be enabled when network access is on. " +
				"Enable 'Require authentication' in settings before starting the server."
			);
		}

		this.httpServer = http.createServer(async (req, res) => {
			// Restrict CORS to localhost origins only
			const origin = req.headers["origin"];
			if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
				res.setHeader("Access-Control-Allow-Origin", origin);
			}
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
			res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			// Health check is intentionally public — returns no sensitive data
			// and allows clients/monitors to check availability before authenticating.
			if (req.url === "/health" || req.url === "/") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ status: "ok", version: "1.0.0" }));
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

			if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
				await this.handleMcpRequest(req, res);
				return;
			}

			// SSE transport endpoints (legacy — required by Claude Desktop)
			if (req.url === "/sse" && req.method === "GET") {
				await this.handleSseConnect(req, res);
				return;
			}

			if (req.url?.startsWith("/messages") && req.method === "POST") {
				await this.handleSseMessage(req, res);
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

		// Cryptographically secure session ID
		const sid = randomBytes(32).toString("hex");

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
		console.log(`[MCP Server] Session created (total: ${this.sessions.size})`);

		transport.onclose = () => {
			this.sessions.delete(sid);
			server.close().catch(() => {});
			console.log(`[MCP Server] Session closed (total: ${this.sessions.size})`);
		};

		await transport.handleRequest(req, res);
	}

	private async handleSseConnect(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const transport = new SSEServerTransport("/messages", res);
		const server = new McpServer({ name: "obsidian-mcp-server", version: "1.0.0" });
		registerTools(server, this.app);
		await server.connect(transport);

		const sid = transport.sessionId;
		this.sseSessions.set(sid, { server, transport });
		console.log(`[MCP Server] SSE session created: ${sid} (total: ${this.sseSessions.size})`);

		transport.onclose = () => {
			this.sseSessions.delete(sid);
			server.close().catch(() => {});
			console.log(`[MCP Server] SSE session closed (total: ${this.sseSessions.size})`);
		};

		await transport.start();
	}

	private async handleSseMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url!, `http://localhost`);
		const sid = url.searchParams.get("sessionId");

		if (!sid || !this.sseSessions.has(sid)) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "SSE session not found" }));
			return;
		}

		await this.sseSessions.get(sid)!.transport.handlePostMessage(req, res);
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

		for (const { server, transport } of this.sseSessions.values()) {
			transport.onclose = undefined;
			await server.close().catch(() => {});
			await transport.close().catch(() => {});
		}
		this.sseSessions.clear();

		this.running = false;
	}
}
