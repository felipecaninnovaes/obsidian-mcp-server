import { moment } from "obsidian";

export interface TemplateVariables {
	title?: string;
	[key: string]: unknown;
}

/**
 * Expands template strings with variable substitution.
 * Supports: {{date}}, {{date:format}}, {{title}}, {{time}}
 */
export function expandTemplate(template: string, vars: TemplateVariables = {}): string {
	let result = template;

	// Replace {{date}} with current date in YYYY-MM-DD format
	result = result.replace(/\{\{date\}\}/g, () => {
		return moment().format("YYYY-MM-DD");
	});

	// Replace {{date:format}} with date in custom format
	result = result.replace(/\{\{date:([^}]+)\}\}/g, (match, format: string) => {
		return moment().format(format);
	});

	// Replace {{title}} with the provided title variable
	result = result.replace(/\{\{title\}\}/g, () => {
		return vars.title ?? "";
	});

	// Replace {{time}} with current time in HH:mm format
	result = result.replace(/\{\{time\}\}/g, () => {
		return moment().format("HH:mm");
	});

	return result;
}
