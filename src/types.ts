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
}

export const DEFAULT_SETTINGS: McpServerSettings = {
	port: 27123,
	apiKey: "",
	enableAuth: true,
	autoStart: true,
	networkAccess: false,
	logLevel: "info",
	permissions: "read-write",
};
