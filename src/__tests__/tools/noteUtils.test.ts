import { describe, it, expect } from "vitest";
import { TFile } from "obsidian";

// ── Minimal App/Vault mock ─────────────────────────────────────────────────────

function makeFile(path: string): TFile {
	const f = new TFile();
	f.path = path;
	const slash = path.lastIndexOf("/");
	const name = slash >= 0 ? path.slice(slash + 1) : path;
	const dot = name.lastIndexOf(".");
	f.basename = dot >= 0 ? name.slice(0, dot) : name;
	f.extension = dot >= 0 ? name.slice(dot + 1) : "";
	return f;
}

function makeApp(files: TFile[]) {
	const pathMap = new Map(files.map((f) => [f.path, f]));
	return {
		vault: {
			getAbstractFileByPath: (p: string) => pathMap.get(p) ?? null,
			getMarkdownFiles: () => files.filter((f) => f.extension === "md"),
		},
	};
}

// Import after mock is set up (vitest resolves 'obsidian' via the alias in vitest.config.ts)
import { resolveNoteFile } from "../../server/tools/noteUtils";

// ── Step 1: Exact match ───────────────────────────────────────────────────────

describe("resolveNoteFile — exact match", () => {
	it("returns file for exact path with extension", () => {
		const file = makeFile("Folder/Note.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "Folder/Note.md")).toBe(file);
	});

	it("returns file for root-level exact path", () => {
		const file = makeFile("MyNote.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "MyNote.md")).toBe(file);
	});
});

// ── Step 2: Auto-append .md ───────────────────────────────────────────────────

describe("resolveNoteFile — auto .md append", () => {
	it("appends .md when path has no extension", () => {
		const file = makeFile("Folder/Note.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "Folder/Note")).toBe(file);
	});

	it("appends .md for root-level path with no extension", () => {
		const file = makeFile("Note.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "Note")).toBe(file);
	});
});

// ── Step 3: Prefix match (the LLM truncation fix) ─────────────────────────────

describe("resolveNoteFile — prefix match (handles LLM path truncation at spaces)", () => {
	it("resolves when LLM truncates at the space: 'Folder/01' → 'Folder/01 - Title.md'", () => {
		const file = makeFile("PESSOAL/MINHA HISTORIA/01 - Quem foi Alex.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "PESSOAL/MINHA HISTORIA/01")).toBe(file);
	});

	it("resolves when basename prefix matches unambiguously", () => {
		const file = makeFile("Projects/2026 - My Project.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "Projects/2026")).toBe(file);
	});

	it("resolves root-level prefix match", () => {
		const file = makeFile("01 - My Note.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "01")).toBe(file);
	});

	it("returns null when prefix is ambiguous (multiple candidates)", () => {
		const a = makeFile("HISTORIA/01 - Note A.md");
		const b = makeFile("HISTORIA/01 - Note B.md");
		const app = makeApp([a, b]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "HISTORIA/01")).toBeNull();
	});

	it("does not match files in sibling folders", () => {
		const file = makeFile("OtherFolder/01 - Note.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		// Searching in "Folder/01" — different parent, should NOT match
		expect(resolveNoteFile(app, "Folder/01")).toBeNull();
	});

	it("does not match when prefix is empty string", () => {
		const file = makeFile("Folder/Note.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "Folder")).toBeNull();
	});

	it("returns null when no files exist", () => {
		const app = makeApp([]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "Folder/01")).toBeNull();
	});

	it("prefix match is case-sensitive (vault paths are case-sensitive)", () => {
		const file = makeFile("Folder/Abc - Title.md");
		const app = makeApp([file]);
		// @ts-expect-error — minimal app mock
		expect(resolveNoteFile(app, "Folder/abc")).toBeNull();
	});
});
