import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VaultIndex } from "../VaultIndex";
import { BacklinkIndex } from "../BacklinkIndex";
import { DeleteLog } from "../DeleteLog";
import { AuditLog } from "../AuditLog";
import { SemanticIndex } from "../SemanticIndex";
import type { Permissions } from "../../types";
import { registerFileTools } from "./fileTools";
import { registerSearchTools } from "./searchTools";
import { registerMetadataTools } from "./metadataTools";
import { registerGraphTools } from "./graphTools";
import { registerDailyNoteTools } from "./dailyNoteTools";
import { registerCanvasTools } from "./canvasTools";
import { registerSemanticSearchTools } from "./semanticSearchTools";
import { registerVaultResources } from "./resources";

/** All cross-cutting dependencies threaded into tool handlers. */
export interface ToolDependencies {
	vaultIndex: VaultIndex;
	backlinkIndex: BacklinkIndex;
	deleteLog: DeleteLog;
	permissions: Permissions;
	auditLog: AuditLog;
	/** Cryptographic session ID baked in at session-creation time for audit entries. */
	sessionId: string;
	semanticIndex: SemanticIndex;
}

export function registerTools(server: McpServer, app: App, deps: ToolDependencies): void {
	registerFileTools(server, app, deps);
	registerSearchTools(server, app, deps.vaultIndex);
	registerMetadataTools(server, app, deps);
	registerGraphTools(server, app, deps.vaultIndex, deps.backlinkIndex);
	registerDailyNoteTools(server, app);
	registerCanvasTools(server, app, deps);
	registerSemanticSearchTools(server, app, deps.semanticIndex);
	registerVaultResources(server, app);
}
