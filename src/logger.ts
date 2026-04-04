import type { LogLevel } from "./types";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const PREFIX = "[MCP Server]";

class Logger {
	private level: LogLevel = "info";

	setLevel(level: LogLevel): void {
		this.level = level;
	}

	debug(...args: unknown[]): void {
		if (LEVELS[this.level] <= 0) console.debug(PREFIX, ...args);
	}

	info(...args: unknown[]): void {
		if (LEVELS[this.level] <= 1) console.info(PREFIX, ...args);
	}

	warn(...args: unknown[]): void {
		if (LEVELS[this.level] <= 2) console.warn(PREFIX, ...args);
	}

	error(...args: unknown[]): void {
		if (LEVELS[this.level] <= 3) console.error(PREFIX, ...args);
	}
}

export const logger = new Logger();
