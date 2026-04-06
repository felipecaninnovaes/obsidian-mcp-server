import { App, TFile } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sanitizePath, assertWritePermission, MAX_PATH_LENGTH } from "./utils";
import { MAX_CONTENT_LENGTH } from "../../constants";
import { summarizeParams } from "../AuditLog";
import type { ToolDependencies } from "./index";

// Type definitions for canvas JSON structure
export interface CanvasNode {
	id: string;
	type: "text" | "file" | "link";
	text?: string;
	file?: string;
	url?: string;
	x: number;
	y: number;
	width?: number;
	height?: number;
	color?: string;
	label?: string;
}

export interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
	label?: string;
	color?: string;
	fromSide?: string;
	toSide?: string;
}

export interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
}

export function registerCanvasTools(server: McpServer, app: App, deps: ToolDependencies): void {
	const { permissions, auditLog, sessionId } = deps;
	registerReadCanvas(server, app);
	registerUpdateCanvas(server, app, permissions, auditLog, sessionId);
}

function registerReadCanvas(server: McpServer, app: App): void {
	server.registerTool(
		"read_canvas",
		{
			description: "Lê o conteúdo de um arquivo canvas (.canvas) e retorna nodes e edges em JSON.",
			inputSchema: {
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho do arquivo canvas (ex: MyCanvas.canvas)"),
			},
		},
		async ({ path }) => {
			const safePath = sanitizePath(path);
			const file = app.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) throw new Error("Arquivo canvas não encontrado");
			if (!safePath.endsWith(".canvas")) throw new Error("Arquivo não é um canvas (.canvas)");

			const content = await app.vault.read(file);
			let canvasData: CanvasData;
			try {
				canvasData = JSON.parse(content) as CanvasData;
			} catch {
				throw new Error("Erro ao parsear JSON do canvas");
			}

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(canvasData, null, 2),
					},
				],
			};
		}
	);
}

function registerUpdateCanvas(
	server: McpServer, app: App,
	permissions: ToolDependencies["permissions"],
	auditLog: ToolDependencies["auditLog"],
	sessionId: string
): void {
	server.registerTool(
		"update_canvas",
		{
			description: "Atualiza um canvas adicionando ou removendo nodes/edges.",
			inputSchema: z.object({
				path: z.string().max(MAX_PATH_LENGTH).describe("Caminho do arquivo canvas"),
				add_nodes: z
					.array(z.unknown())
					.optional()
					.describe("Array de nodes a adicionar"),
				add_edges: z
					.array(z.unknown())
					.optional()
					.describe("Array de edges a adicionar"),
				remove_node_ids: z
					.array(z.string())
					.optional()
					.describe("Array de IDs de nodes a remover"),
				remove_edge_ids: z
					.array(z.string())
					.optional()
					.describe("Array de IDs de edges a remover"),
			}),
		},
		async ({ path, add_nodes, add_edges, remove_node_ids, remove_edge_ids }) => {
			assertWritePermission(permissions);
			const safePath = sanitizePath(path);
			const file = app.vault.getAbstractFileByPath(safePath);
			if (!(file instanceof TFile)) throw new Error("Arquivo canvas não encontrado");
			if (!safePath.endsWith(".canvas")) throw new Error("Arquivo não é um canvas (.canvas)");

			const content = await app.vault.read(file);
			let canvasData: CanvasData;
			try {
				canvasData = JSON.parse(content) as CanvasData;
			} catch {
				throw new Error("Erro ao parsear JSON do canvas");
			}

			// Add nodes
			if (add_nodes && add_nodes.length > 0) {
				for (const nodeData of add_nodes) {
					const node = nodeData as CanvasNode;
					if (!node.id || node.x === undefined || node.y === undefined) {
						throw new Error("Node deve ter id, x e y");
					}
					if (!node.type) throw new Error("Node deve ter type");
					canvasData.nodes.push(node);
				}
			}

			// Add edges
			if (add_edges && add_edges.length > 0) {
				for (const edgeData of add_edges) {
					const edge = edgeData as CanvasEdge;
					if (!edge.id || !edge.fromNode || !edge.toNode) {
						throw new Error("Edge deve ter id, fromNode e toNode");
					}
					canvasData.edges.push(edge);
				}
			}

			// Remove nodes (also removes edges connected to them)
			if (remove_node_ids && remove_node_ids.length > 0) {
				const idsToRemove = new Set(remove_node_ids);
				canvasData.nodes = canvasData.nodes.filter((n) => !idsToRemove.has(n.id));
				canvasData.edges = canvasData.edges.filter(
					(e) => !idsToRemove.has(e.fromNode) && !idsToRemove.has(e.toNode)
				);
			}

			// Remove edges
			if (remove_edge_ids && remove_edge_ids.length > 0) {
				const idsToRemove = new Set(remove_edge_ids);
				canvasData.edges = canvasData.edges.filter((e) => !idsToRemove.has(e.id));
			}

			// Write updated canvas
			const updatedContent = JSON.stringify(canvasData, null, 2);
			if (updatedContent.length > MAX_CONTENT_LENGTH) {
				throw new Error("Conteúdo do canvas é muito grande");
			}

			await app.vault.modify(file, updatedContent);
			auditLog.record({
				timestamp: Date.now(),
				sessionId,
				tool: "update_canvas",
				params_summary: summarizeParams({ path: safePath }),
				result: "ok",
			});

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								updated: true,
								nodes_count: canvasData.nodes.length,
								edges_count: canvasData.edges.length,
							},
							null,
							2
						),
					},
				],
			};
		}
	);
}
