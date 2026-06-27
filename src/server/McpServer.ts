import { App } from "obsidian";
import express from "express";
import cors from "cors";
import { McpServerSettings } from "../types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { registerTools } from "./tools/index";
import { VaultIndex } from "./VaultIndex";
import { BacklinkIndex } from "./BacklinkIndex";
import { DeleteLog } from "./DeleteLog";
import { SemanticIndex } from "./SemanticIndex";
import { isRateLimited, recordAuthFailure, cleanupExpiredEntries, SessionRateLimiter } from "./rateLimiting";
import { AuditLog } from "./AuditLog";
import { logger } from "../logger";
import * as http from "http";
import { randomBytes, timingSafeEqual, createHash } from "crypto";
import { MAX_SESSIONS, MAX_BODY_SIZE, VAULT_DEBOUNCE_MS } from "../constants";

interface StreamableSession {
	server: McpServer;
	transport: StreamableHTTPServerTransport;
	cleanupVaultListeners: () => void;
}

interface SseSession {
	server: McpServer;
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	transport: SSEServerTransport;
	cleanupVaultListeners: () => void;
}

export class ObsidianMcpServer {

	private app: App;
	private settings: McpServerSettings;
	private vaultIndex: VaultIndex;
	private backlinkIndex: BacklinkIndex;
	private deleteLog: DeleteLog;
	private semanticIndex: SemanticIndex;
	private readonly auditLog = new AuditLog();
	private readonly sessionRateLimiter = new SessionRateLimiter();
	private httpServer: http.Server | null = null;
	private sessions = new Map<string, StreamableSession>();
	private sseSessions = new Map<string, SseSession>();
	private running = false;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	constructor(app: App, settings: McpServerSettings, vaultIndex: VaultIndex, backlinkIndex: BacklinkIndex, deleteLog: DeleteLog, semanticIndex: SemanticIndex) {
		this.app = app;
		this.settings = settings;
		this.vaultIndex = vaultIndex;
		this.backlinkIndex = backlinkIndex;
		this.deleteLog = deleteLog;
		this.semanticIndex = semanticIndex;
	}

	/**
	 * Subscribes to vault events and calls server.sendResourceListChanged() with a 500 ms debounce.
	 * Returns a cleanup function to unregister the listeners.
	 */
	private setupVaultListeners(server: McpServer): () => void {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const notify = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				server.sendResourceListChanged();
			}, VAULT_DEBOUNCE_MS);
		};
		const refModify = this.app.vault.on("modify", notify);
		const refCreate = this.app.vault.on("create", notify);
		const refDelete = this.app.vault.on("delete", notify);
		const refRename = this.app.vault.on("rename", notify);
		return () => {
			if (timer) clearTimeout(timer);
			this.app.vault.offref(refModify);
			this.app.vault.offref(refCreate);
			this.app.vault.offref(refDelete);
			this.app.vault.offref(refRename);
		};
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

		const app = express();

		// Disable x-powered-by header
		app.disable("x-powered-by");

		// CORS Middleware
		app.use(cors({
			origin: (origin, callback) => {
				if (!origin) return callback(null, true);
				
				const allowedOrigins = (this.settings.allowedOrigins || "")
					.split(",")
					.map((o) => o.trim())
					.filter((o) => o.length > 0);

				try {
					const url = new URL(origin);
					if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || allowedOrigins.includes(origin)) {
						return callback(null, true);
					}
				} catch (e) {
					// Ignore invalid origins
				}
				
				// Return callback(null, false) to block CORS but not crash the request
				callback(null, false);
			},
			methods: ["GET", "POST", "DELETE", "OPTIONS"],
			allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id"],
			exposedHeaders: ["Mcp-Session-Id"]
		}));

		// Auth and Rate Limit Middleware
		app.use((req, res, next) => {
			logger.debug(`Incoming Request: ${req.method} ${req.url}`);
			
			if (req.path === "/health" || req.path === "/") {
				return next();
			}

			if (req.method === "POST") {
				const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
				if (contentLength > MAX_BODY_SIZE) {
					res.status(413).json({ error: "Payload too large" });
					return;
				}

				const ct = req.headers["content-type"] ?? "";
				if (!ct.startsWith("application/json")) {
					res.status(415).json({ error: "Unsupported Media Type: Content-Type must be application/json" });
					return;
				}
			}

			if (this.settings.enableAuth && req.method !== "OPTIONS") {
				const clientIp = req.socket.remoteAddress ?? "unknown";

				if (isRateLimited(clientIp)) {
					res.status(429).json({ error: "Too many requests" });
					return;
				}

				const authHeader = req.headers["authorization"];
				const expected = `Bearer ${this.settings.apiKey}`;
				const supplied = authHeader ?? "";
				
				const expectedHash = createHash("sha256").update(expected).digest();
				const suppliedHash = createHash("sha256").update(supplied).digest();
				const isValid = timingSafeEqual(expectedHash, suppliedHash);

				if (!isValid) {
					recordAuthFailure(clientIp);
					res.status(401).json({ error: "Unauthorized" });
					return;
				}
			}
			next();
		});

		// Routes
		app.get(["/health", "/"], (req, res) => {
			res.json({ status: "ok", version: "1.0.0" });
		});

		app.all("/mcp", async (req, res) => {
			if (req.method === "GET" && req.headers["accept"]?.includes("text/event-stream")) {
				await this.handleSseConnect(req, res);
				return;
			}
			await this.handleMcpRequest(req, res);
		});

		// SSE transport endpoints (legacy — required by Claude Desktop)
		app.get("/sse", async (req, res) => {
			await this.handleSseConnect(req, res);
		});

		app.post("/messages", async (req, res) => {
			await this.handleSseMessage(req, res);
		});

		// 404 Handler
		app.use((req, res) => {
			res.status(404).json({ error: "Not Found" });
		});

		this.httpServer = http.createServer(app);

		const bindHost = this.settings.networkAccess ? "0.0.0.0" : "127.0.0.1";

		logger.setLevel(this.settings.logLevel);

		await new Promise<void>((resolve, reject) => {
			const onError = (err: Error) => reject(err);
			this.httpServer!.once("error", onError);
			this.httpServer!.listen(this.settings.port, bindHost, () => {
				this.httpServer!.removeListener("error", onError);
				this.httpServer!.on("error", (err) => {
					logger.error("HTTP Server error:", err);
				});
				logger.info(`Listening on http://${bindHost}:${this.settings.port}/mcp`);
				resolve();
			});
		});

		this.running = true;

		// Periodically evict expired rate-limit entries to prevent unbounded memory growth
		this.cleanupInterval = setInterval(cleanupExpiredEntries, 5 * 60_000);
	}

	private async handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const sessionId = req.headers["mcp-session-id"] as string | undefined;

		// Route to existing session
		if (sessionId && this.sessions.has(sessionId)) {
			if (!this.sessionRateLimiter.check(sessionId)) {
				res.writeHead(429, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Too many requests — session rate limit exceeded (120 req/min)" }));
				return;
			}
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

		if (this.sessions.size >= MAX_SESSIONS) {
			res.writeHead(503, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Too many active sessions" }));
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

		registerTools(server, this.app, {
			vaultIndex: this.vaultIndex,
			backlinkIndex: this.backlinkIndex,
			deleteLog: this.deleteLog,
			permissions: this.settings.permissions,
			auditLog: this.auditLog,
			sessionId: sid,
			semanticIndex: this.semanticIndex,
		});
		await server.connect(transport);

		const cleanupVaultListeners = this.setupVaultListeners(server);
		this.sessions.set(sid, { server, transport, cleanupVaultListeners });
		logger.debug(`Session created (total: ${this.sessions.size})`);

		let isClosing = false;
		transport.onclose = () => {
			if (isClosing) return;
			isClosing = true;
			this.sessions.get(sid)?.cleanupVaultListeners();
			this.sessions.delete(sid);
			this.sessionRateLimiter.evict(sid);
			server.close().catch(() => {});
			logger.debug(`Session closed (total: ${this.sessions.size})`);
		};

		await transport.handleRequest(req, res);
	}

	private async handleSseConnect(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		if (this.sseSessions.size >= MAX_SESSIONS) {
			res.writeHead(503, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Too many active sessions" }));
			return;
		}

		// eslint-disable-next-line @typescript-eslint/no-deprecated
		const transport = new SSEServerTransport("/messages", res);
		const server = new McpServer({ name: "obsidian-mcp-server", version: "1.0.0" });
		const sid = transport.sessionId;
		registerTools(server, this.app, {
			vaultIndex: this.vaultIndex,
			backlinkIndex: this.backlinkIndex,
			deleteLog: this.deleteLog,
			permissions: this.settings.permissions,
			auditLog: this.auditLog,
			sessionId: sid,
			semanticIndex: this.semanticIndex,
		});
		await server.connect(transport);

		const cleanupVaultListeners = this.setupVaultListeners(server);
		this.sseSessions.set(sid, { server, transport, cleanupVaultListeners });
		logger.debug(`SSE session created: ${sid} (total: ${this.sseSessions.size})`);

		let isClosing = false;
		transport.onclose = () => {
			if (isClosing) return;
			isClosing = true;
			this.sseSessions.get(sid)?.cleanupVaultListeners();
			this.sseSessions.delete(sid);
			this.sessionRateLimiter.evict(sid);
			server.close().catch(() => {});
			logger.debug(`SSE session closed (total: ${this.sseSessions.size})`);
		};
	}

	private async handleSseMessage(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const url = new URL(req.url!, `http://localhost`);
		const sid = url.searchParams.get("sessionId");

		if (!sid || !this.sseSessions.has(sid)) {
			res.writeHead(404, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "SSE session not found" }));
			return;
		}

		if (!this.sessionRateLimiter.check(sid)) {
			res.writeHead(429, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ error: "Too many requests — session rate limit exceeded (120 req/min)" }));
			return;
		}

		await this.sseSessions.get(sid)!.transport.handlePostMessage(req, res);
	}

	async stop(): Promise<void> {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Close sessions first to end active SSE streams
		for (const { server, transport, cleanupVaultListeners } of this.sessions.values()) {
			cleanupVaultListeners();
			transport.onclose = undefined;
			await server.close().catch(() => {});
			await transport.close().catch(() => {});
		}
		this.sessions.clear();

		for (const { server, transport, cleanupVaultListeners } of this.sseSessions.values()) {
			cleanupVaultListeners();
			transport.onclose = undefined;
			await server.close().catch(() => {});
			await transport.close().catch(() => {});
		}
		this.sseSessions.clear();

		if (this.httpServer) {
			// Force close all lingering keep-alive connections
			if ("closeAllConnections" in this.httpServer) {
				(this.httpServer as any).closeAllConnections();
			}
			await new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve());
			});
			this.httpServer = null;
		}

		this.running = false;
	}
}
