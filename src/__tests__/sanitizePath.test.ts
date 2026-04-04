import { describe, it, expect } from "vitest";
import { sanitizePath, MAX_PATH_LENGTH } from "../server/tools/utils";

describe("sanitizePath", () => {
	describe("valid paths", () => {
		it("returns a simple note name unchanged", () => {
			expect(sanitizePath("note.md")).toBe("note.md");
		});

		it("returns a nested path unchanged", () => {
			expect(sanitizePath("folder/sub/note.md")).toBe("folder/sub/note.md");
		});

		it("normalizes backslashes to forward slashes", () => {
			expect(sanitizePath("folder\\sub\\note.md")).toBe("folder/sub/note.md");
		});

		it("collapses redundant dot segments", () => {
			expect(sanitizePath("folder/./note.md")).toBe("folder/note.md");
		});

		it("collapses leading dot segment", () => {
			expect(sanitizePath("./note.md")).toBe("note.md");
		});

		it("collapses double slashes", () => {
			expect(sanitizePath("folder//note.md")).toBe("folder/note.md");
		});

		it("strips trailing slash segment", () => {
			expect(sanitizePath("folder/note.md/")).toBe("folder/note.md");
		});
	});

	describe("rejection: path traversal", () => {
		it("rejects '../etc/passwd'", () => {
			expect(() => sanitizePath("../etc/passwd")).toThrow("not allowed");
		});

		it("rejects 'folder/../../../etc/passwd'", () => {
			expect(() => sanitizePath("folder/../../../etc/passwd")).toThrow("not allowed");
		});

		it("rejects '..' alone", () => {
			expect(() => sanitizePath("..")).toThrow("not allowed");
		});

		it("rejects 'folder/..'", () => {
			expect(() => sanitizePath("folder/..")).toThrow("not allowed");
		});
	});

	describe("rejection: absolute paths", () => {
		it("rejects '/etc/passwd'", () => {
			expect(() => sanitizePath("/etc/passwd")).toThrow("not allowed");
		});

		it("rejects '/note.md'", () => {
			expect(() => sanitizePath("/note.md")).toThrow("not allowed");
		});
	});

	describe("rejection: empty result", () => {
		it("rejects empty string", () => {
			expect(() => sanitizePath("")).toThrow("empty after normalization");
		});

		it("rejects string of only slashes (caught as absolute path)", () => {
			expect(() => sanitizePath("///")).toThrow("not allowed");
		});

		it("rejects string of only dots and slashes", () => {
			expect(() => sanitizePath("././.")).toThrow("empty after normalization");
		});
	});

	describe("rejection: path too long", () => {
		it("rejects paths longer than MAX_PATH_LENGTH", () => {
			expect(() => sanitizePath("a".repeat(MAX_PATH_LENGTH + 1))).toThrow("too long");
		});

		it("accepts paths exactly at MAX_PATH_LENGTH", () => {
			// Construct a valid path that is exactly MAX_PATH_LENGTH characters
			const name = "a".repeat(MAX_PATH_LENGTH - 3) + ".md";
			expect(() => sanitizePath(name)).not.toThrow();
		});
	});
});
