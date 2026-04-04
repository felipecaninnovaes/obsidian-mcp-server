import { App } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VaultIndex } from "../VaultIndex";
import { BacklinkIndex } from "../BacklinkIndex";
import { registerFileTools } from "./fileTools";
import { registerSearchTools } from "./searchTools";
import { registerMetadataTools } from "./metadataTools";
import { registerGraphTools } from "./graphTools";
import { registerDailyNoteTools } from "./dailyNoteTools";
import { registerVaultResources } from "./resources";

export function registerTools(server: McpServer, app: App, vaultIndex: VaultIndex, backlinkIndex: BacklinkIndex): void {
	registerFileTools(server, app);
	registerSearchTools(server, app, vaultIndex);
	registerMetadataTools(server, app);
	registerGraphTools(server, app, vaultIndex, backlinkIndex);
	registerDailyNoteTools(server, app);
	registerVaultResources(server, app);
}
