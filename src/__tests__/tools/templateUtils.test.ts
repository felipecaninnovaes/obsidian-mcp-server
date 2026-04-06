import { describe, it, expect, vi } from "vitest";

// Mock the obsidian moment before importing expandTemplate
vi.mock("obsidian", () => {
	const mockMoment = () => {
		return {
			format: (fmt: string) => {
				// Simple implementation of moment.format for common patterns
				if (fmt === "YYYY-MM-DD") return "2024-01-15";
				if (fmt === "HH:mm") return "14:30";
				if (fmt === "DD/MM/YYYY") return "15/01/2024";
				if (fmt === "MMMM YYYY") return "January 2024";
				if (fmt === "MMMM") return "January";
				if (fmt === "YYYY-MM-DD HH:mm:ss") return "2024-01-15 14:30:45";
				return fmt; // fallback
			},
		};
	};

	return {
		moment: mockMoment,
	};
});

import { expandTemplate } from "../../server/tools/templateUtils";

describe("expandTemplate()", () => {
	// ── {{date}} ──────────────────────────────────────────────────────────────

	it("expands {{date}} to YYYY-MM-DD format", () => {
		const result = expandTemplate("Created on {{date}}");
		expect(result).toBe("Created on 2024-01-15");
	});

	it("expands multiple {{date}} occurrences", () => {
		const result = expandTemplate("Start: {{date}}, End: {{date}}");
		expect(result).toBe("Start: 2024-01-15, End: 2024-01-15");
	});

	// ── {{date:format}} ───────────────────────────────────────────────────────

	it("expands {{date:format}} with custom format", () => {
		const result = expandTemplate("Date: {{date:DD/MM/YYYY}}");
		expect(result).toBe("Date: 15/01/2024");
	});

	it("expands {{date:format}} with time format", () => {
		const result = expandTemplate("Month: {{date:MMMM YYYY}}");
		expect(result).toBe("Month: January 2024");
	});

	it("expands multiple {{date:format}} with different formats", () => {
		const result = expandTemplate("Date: {{date:YYYY-MM-DD}}, Month: {{date:MMMM}}");
		expect(result).toBe("Date: 2024-01-15, Month: January");
	});

	it("handles {{date:format}} with special characters", () => {
		const result = expandTemplate("Timestamp: {{date:YYYY-MM-DD HH:mm:ss}}");
		expect(result).toBe("Timestamp: 2024-01-15 14:30:45");
	});

	// ── {{title}} ─────────────────────────────────────────────────────────────

	it("expands {{title}} with provided title", () => {
		const result = expandTemplate("Note: {{title}}", { title: "My Note" });
		expect(result).toBe("Note: My Note");
	});

	it("expands {{title}} to empty string when not provided", () => {
		const result = expandTemplate("Note: {{title}}");
		expect(result).toBe("Note: ");
	});

	it("expands {{title}} with multiple occurrences", () => {
		const result = expandTemplate("Title: {{title}}, Heading: # {{title}}", { title: "Important" });
		expect(result).toBe("Title: Important, Heading: # Important");
	});

	it("handles {{title}} with special characters", () => {
		const result = expandTemplate("Title: {{title}}", { title: "My (Very) Important Note!" });
		expect(result).toBe("Title: My (Very) Important Note!");
	});

	// ── {{time}} ──────────────────────────────────────────────────────────────

	it("expands {{time}} to HH:mm format", () => {
		const result = expandTemplate("Time: {{time}}");
		expect(result).toBe("Time: 14:30");
	});

	it("expands multiple {{time}} occurrences", () => {
		const result = expandTemplate("Start: {{time}}, End: {{time}}");
		expect(result).toBe("Start: 14:30, End: 14:30");
	});

	// ── Mixed variables ───────────────────────────────────────────────────────

	it("expands multiple different variables together", () => {
		const result = expandTemplate(
			"# {{title}}\n\nCreated: {{date}} at {{time}}",
			{ title: "My Note" }
		);
		expect(result).toBe("# My Note\n\nCreated: 2024-01-15 at 14:30");
	});

	it("expands template with all variable types", () => {
		const result = expandTemplate(
			"Title: {{title}}\nDate: {{date}}\nFormatted: {{date:DD/MM/YYYY}}\nTime: {{time}}",
			{ title: "Test" }
		);
		expect(result).toBe(
			"Title: Test\nDate: 2024-01-15\nFormatted: 15/01/2024\nTime: 14:30"
		);
	});

	// ── Edge cases ────────────────────────────────────────────────────────────

	it("returns original text when no variables are present", () => {
		const text = "This is just plain text with no variables.";
		const result = expandTemplate(text);
		expect(result).toBe(text);
	});

	it("handles empty template string", () => {
		const result = expandTemplate("");
		expect(result).toBe("");
	});

	it("handles malformed variable syntax (not replaced)", () => {
		const result = expandTemplate("Invalid: {{notavar}}, Title: {{title}}", { title: "Test" });
		expect(result).toBe("Invalid: {{notavar}}, Title: Test");
	});

	it("handles date format with unmatched braces", () => {
		// {{date:YYYY-MM-DD}} should match, but {{date:YYYY-MM-DD]] won't
		const result = expandTemplate("Date: {{date:YYYY-MM-DD}} and text");
		expect(result).toBe("Date: 2024-01-15 and text");
	});

	it("case-sensitive variable names", () => {
		const result = expandTemplate("{{Title}} {{TITLE}} {{title}}", { title: "test" });
		// Only {{title}} (lowercase) should be expanded
		expect(result).toBe("{{Title}} {{TITLE}} test");
	});

	// ── Real-world templates ──────────────────────────────────────────────────

	it("expands daily note template", () => {
		const template = `# {{title}}
Created: {{date}} at {{time}}

## Tasks
- [ ] Task 1

## Notes
`;
		const result = expandTemplate(template, { title: "2024-01-15" });
		expect(result).toContain("# 2024-01-15");
		expect(result).toContain("Created: 2024-01-15 at 14:30");
	});

	it("expands project note template with formatted date", () => {
		const template = `# Project: {{title}}
Started: {{date:DD/MM/YYYY}}
Month: {{date:MMMM YYYY}}

## Progress
- [ ] Phase 1
`;
		const result = expandTemplate(template, { title: "MyProject" });
		expect(result).toContain("# Project: MyProject");
		expect(result).toContain("Month: January 2024");
	});

	// ── Unicode and special characters ─────────────────────────────────────────

	it("handles unicode in title", () => {
		const result = expandTemplate("Title: {{title}}", { title: "Notas 日本語 🎉" });
		expect(result).toBe("Title: Notas 日本語 🎉");
	});

	it("handles newlines in template", () => {
		const result = expandTemplate("Line 1\nDate: {{date}}\nLine 3");
		expect(result).toBe("Line 1\nDate: 2024-01-15\nLine 3");
	});

	// ── Extra variables in context (should be ignored) ──────────────────────

	it("ignores extra variables not used in template", () => {
		const result = expandTemplate("Title: {{title}}", {
			title: "Used",
			unused: "Ignored",
			another: "Also Ignored",
		});
		expect(result).toBe("Title: Used");
	});
});
