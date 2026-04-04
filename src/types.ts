export type LogLevel = "debug" | "info" | "warn" | "error";

export interface McpServerSettings {
	port: number;
	apiKey: string;
	enableAuth: boolean;
	autoStart: boolean;
	networkAccess: boolean;
	logLevel: LogLevel;
}

export const DEFAULT_SETTINGS: McpServerSettings = {
	port: 27123,
	apiKey: "",
	enableAuth: true,
	autoStart: true,
	networkAccess: false,
	logLevel: "info",
};
