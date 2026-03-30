# Obsidian MCP Server Plugin — Guia Completo de Desenvolvimento

> Plugin nativo que embute um MCP Server HTTP diretamente no Obsidian.  
> O usuário instala → configura a URL no IDE → conecta. Sem dependências externas.

---

## Sumário

1. [Visão Geral da Arquitetura](#1-visão-geral-da-arquitetura)
2. [Pré-requisitos e Setup do Ambiente](#2-pré-requisitos-e-setup-do-ambiente)
3. [Estrutura de Arquivos do Projeto](#3-estrutura-de-arquivos-do-projeto)
4. [Configuração dos Arquivos Base](#4-configuração-dos-arquivos-base)
5. [Implementação: Entry Point do Plugin](#5-implementação-entry-point-do-plugin)
6. [Implementação: MCP Server HTTP](#6-implementação-mcp-server-http)
7. [Implementação: Vault Tools](#7-implementação-vault-tools)
8. [Implementação: Settings UI](#8-implementação-settings-ui)
9. [Build e Testes](#9-build-e-testes)
10. [Configuração nos MCP Clients](#10-configuração-nos-mcp-clients)
11. [Publicação na Community Plugins](#11-publicação-na-community-plugins)
12. [Referências](#12-referências)

---

## 1. Visão Geral da Arquitetura

### Como funciona

```
┌─────────────────────────────────────────────────┐
│              Obsidian (Electron + Node.js)       │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │           Plugin (main.ts)               │   │
│  │                                          │   │
│  │  ┌────────────────────────────────────┐  │   │
│  │  │   HTTP Server (Node:http)          │  │   │
│  │  │   localhost:27123 (configurável)   │  │   │
│  │  │                                    │  │   │
│  │  │   POST /mcp  ← JSON-RPC request    │  │   │
│  │  │   GET  /mcp  ← SSE stream          │  │   │
│  │  └───────────────┬────────────────────┘  │   │
│  │                  │                        │   │
│  │  ┌───────────────▼────────────────────┐  │   │
│  │  │   MCP SDK (StreamableHTTP)         │  │   │
│  │  │   Tools: read, write, list, search │  │   │
│  │  └───────────────┬────────────────────┘  │   │
│  │                  │                        │   │
│  │  ┌───────────────▼────────────────────┐  │   │
│  │  │   Obsidian Vault API               │  │   │
│  │  │   app.vault.read/create/modify     │  │   │
│  │  └────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
          ▲ HTTP JSON-RPC (Streamable HTTP)
          │
┌─────────┴──────────┐
│  MCP Client (IDE)  │
│  Claude Desktop    │
│  VS Code + Cline   │
│  Cursor / Roo      │
└────────────────────┘
```

### Transport escolhido: Streamable HTTP

O transport **stdio** (mais comum em MCP servers externos) exige que o cliente faça `spawn` do server como subprocesso. Um plugin Obsidian não pode ser lançado assim — o Obsidian é o processo principal.

O **Streamable HTTP** é a solução correta: o plugin abre um servidor HTTP local e o cliente conecta pela URL. É o transport moderno recomendado pela spec MCP (v2025-03-26), substitui o legado SSE.

### Tools MCP expostos

| Tool | Descrição |
|---|---|
| `list_files` | Lista arquivos e pastas do vault |
| `read_note` | Lê o conteúdo de uma nota |
| `create_note` | Cria uma nova nota |
| `update_note` | Modifica nota existente (append / prepend / overwrite) |
| `delete_note` | Deleta um arquivo do vault |
| `search_vault` | Busca por texto em todas as notas |
| `get_active_note` | Retorna a nota atualmente aberta no Obsidian |
| `get_vault_info` | Metadados do vault (nome, path, contagem de arquivos) |

---

## 2. Pré-requisitos e Setup do Ambiente

### Ferramentas necessárias

```bash
# Node.js (v18+) e npm
node --version   # >= 18
npm --version

# Git
git --version
```

### Clonar o template oficial

```bash
git clone https://github.com/obsidianmd/obsidian-sample-plugin.git obsidian-mcp-server
cd obsidian-mcp-server
npm install
```

### Instalar dependências do projeto

```bash
# SDK oficial do MCP (Anthropic)
npm install @modelcontextprotocol/sdk

# Tipagens do Obsidian (já vem no template, mas confirme)
npm install --save-dev obsidian

# Zod para validação de schemas das tools
npm install zod
```

### Linkar o plugin no vault de desenvolvimento

```bash
# Crie uma pasta de vault para testes (ou use um existente)
mkdir -p ~/ObsidianVaultDev/.obsidian/plugins/obsidian-mcp-server

# Crie um symlink do build para o vault
ln -s $(pwd) ~/ObsidianVaultDev/.obsidian/plugins/obsidian-mcp-server
```

Depois abra o Obsidian com esse vault, vá em **Settings → Community plugins → Turn on community plugins**, e ative seu plugin.

---

## 3. Estrutura de Arquivos do Projeto

```
obsidian-mcp-server/
├── src/
│   ├── main.ts              # Entry point do plugin
│   ├── server/
│   │   ├── McpServer.ts     # HTTP Server + MCP transport
│   │   └── tools/
│   │       ├── index.ts     # Registra todas as tools
│   │       ├── listFiles.ts
│   │       ├── readNote.ts
│   │       ├── createNote.ts
│   │       ├── updateNote.ts
│   │       ├── deleteNote.ts
│   │       ├── searchVault.ts
│   │       ├── getActiveNote.ts
│   │       └── getVaultInfo.ts
│   ├── settings/
│   │   └── SettingsTab.ts   # UI de configurações
│   └── types.ts             # Tipos compartilhados
├── manifest.json
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
└── .gitignore
```

---

## 4. Configuração dos Arquivos Base

### `manifest.json`

```json
{
  "id": "obsidian-mcp-server",
  "name": "MCP Server",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Embeds an MCP Server inside Obsidian. Connect any MCP-compatible IDE or AI client to your vault.",
  "author": "Seu Nome",
  "authorUrl": "https://github.com/seu-usuario",
  "isDesktopOnly": true
}
```

> **`isDesktopOnly: true` é obrigatório** — o plugin usa APIs do Node.js (`http`, `net`) que não existem no Obsidian Mobile.

### `package.json`

```json
{
  "name": "obsidian-mcp-server",
  "version": "1.0.0",
  "description": "MCP Server plugin for Obsidian",
  "main": "main.js",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "version": "node version-bump.mjs && git add manifest.json versions.json"
  },
  "keywords": ["obsidian", "mcp", "ai"],
  "license": "MIT",
  "devDependencies": {
    "@types/node": "^20.0.0",
    "builtin-modules": "^3.3.0",
    "esbuild": "^0.20.0",
    "obsidian": "latest",
    "tslib": "^2.6.0",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES2022",
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "importHelpers": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "lib": ["DOM", "ES2022"],
    "paths": {
      "obsidian": ["node_modules/obsidian/obsidian.d.ts"]
    }
  },
  "include": ["src/**/*.ts"]
}
```

### `esbuild.config.mjs`

```javascript
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository
*/
`;

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,  // IMPORTANTE: inclui 'http', 'net', 'stream', etc.
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
```

> **Atenção:** `...builtins` no array `external` é crítico. Isso diz ao esbuild para não tentar empacotar módulos nativos do Node.js como `http`, `net`, `stream` — eles serão resolvidos pelo Electron em runtime.

### `src/types.ts`

```typescript
export interface McpServerSettings {
  port: number;
  apiKey: string;
  enableAuth: boolean;
  autoStart: boolean;
}

export const DEFAULT_SETTINGS: McpServerSettings = {
  port: 27123,
  apiKey: "",
  enableAuth: true,
  autoStart: true,
};
```

---

## 5. Implementação: Entry Point do Plugin

### `src/main.ts`

```typescript
import { Plugin, Notice } from "obsidian";
import { McpServerSettings, DEFAULT_SETTINGS } from "./types";
import { ObsidianMcpServer } from "./server/McpServer";
import { McpSettingsTab } from "./settings/SettingsTab";
import { randomBytes } from "crypto";

export default class McpServerPlugin extends Plugin {
  settings: McpServerSettings;
  mcpServer: ObsidianMcpServer | null = null;

  async onload() {
    await this.loadSettings();

    // Gera uma API key se não existir
    if (!this.settings.apiKey) {
      this.settings.apiKey = randomBytes(32).toString("hex");
      await this.saveSettings();
    }

    // Adiciona aba de configurações
    this.addSettingTab(new McpSettingsTab(this.app, this));

    // Botão na ribbon (barra lateral)
    const ribbonIcon = this.addRibbonIcon(
      "plug",
      "MCP Server",
      async () => {
        if (this.mcpServer?.isRunning()) {
          await this.stopServer();
        } else {
          await this.startServer();
        }
      }
    );

    // Comandos via Command Palette
    this.addCommand({
      id: "start-mcp-server",
      name: "Start MCP Server",
      callback: async () => await this.startServer(),
    });

    this.addCommand({
      id: "stop-mcp-server",
      name: "Stop MCP Server",
      callback: async () => await this.stopServer(),
    });

    this.addCommand({
      id: "copy-mcp-url",
      name: "Copy MCP Server URL",
      callback: () => {
        const url = `http://localhost:${this.settings.port}/mcp`;
        navigator.clipboard.writeText(url);
        new Notice(`Copied: ${url}`);
      },
    });

    // Auto-start se configurado
    if (this.settings.autoStart) {
      // Pequeno delay para garantir que o Obsidian carregou completamente
      setTimeout(() => this.startServer(), 1000);
    }
  }

  async onunload() {
    await this.stopServer();
  }

  async startServer() {
    if (this.mcpServer?.isRunning()) {
      new Notice("MCP Server já está rodando.");
      return;
    }

    try {
      this.mcpServer = new ObsidianMcpServer(this.app, this.settings);
      await this.mcpServer.start();
      new Notice(`✅ MCP Server iniciado na porta ${this.settings.port}`);
    } catch (err) {
      console.error("[MCP Server] Falha ao iniciar:", err);
      new Notice(`❌ Erro ao iniciar MCP Server: ${err.message}`);
    }
  }

  async stopServer() {
    if (!this.mcpServer?.isRunning()) return;

    try {
      await this.mcpServer.stop();
      this.mcpServer = null;
      new Notice("MCP Server parado.");
    } catch (err) {
      console.error("[MCP Server] Erro ao parar:", err);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

---

## 6. Implementação: MCP Server HTTP

### `src/server/McpServer.ts`

```typescript
import { App } from "obsidian";
import { McpServerSettings } from "../types";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index";
import * as http from "http";

export class ObsidianMcpServer {
  private app: App;
  private settings: McpServerSettings;
  private httpServer: http.Server | null = null;
  private mcpServer: Server | null = null;
  private transport: StreamableHTTPServerTransport | null = null;
  private running = false;

  constructor(app: App, settings: McpServerSettings) {
    this.app = app;
    this.settings = settings;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    // Cria o MCP Server
    this.mcpServer = new Server(
      {
        name: "obsidian-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Registra todas as tools do vault
    registerTools(this.mcpServer, this.app);

    // Cria o transport Streamable HTTP
    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => Math.random().toString(36).slice(2),
    });

    await this.mcpServer.connect(this.transport);

    // Cria o HTTP Server nativo do Node.js
    this.httpServer = http.createServer(async (req, res) => {
      // CORS headers para permitir conexão de IDEs locais
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, Mcp-Session-Id"
      );
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      // Verificação de autenticação
      if (this.settings.enableAuth) {
        const authHeader = req.headers["authorization"];
        const expectedToken = `Bearer ${this.settings.apiKey}`;
        if (authHeader !== expectedToken) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      // Rota de health check
      if (req.url === "/health" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            plugin: "obsidian-mcp-server",
            version: "1.0.0",
            vault: this.app.vault.getName(),
          })
        );
        return;
      }

      // Rota principal do MCP
      if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
        await this.transport!.handleRequest(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });

    // Inicia o servidor na porta configurada
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.settings.port, "127.0.0.1", () => {
        console.log(`[MCP Server] Listening on http://127.0.0.1:${this.settings.port}/mcp`);
        resolve();
      });
      this.httpServer!.on("error", reject);
    });

    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    if (this.mcpServer) {
      await this.mcpServer.close();
      this.mcpServer = null;
    }

    this.transport = null;
    this.running = false;
    console.log("[MCP Server] Stopped.");
  }
}
```

---

## 7. Implementação: Vault Tools

### `src/server/tools/index.ts`

```typescript
import { App } from "obsidian";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { registerListFiles } from "./listFiles";
import { registerReadNote } from "./readNote";
import { registerCreateNote } from "./createNote";
import { registerUpdateNote } from "./updateNote";
import { registerDeleteNote } from "./deleteNote";
import { registerSearchVault } from "./searchVault";
import { registerGetActiveNote } from "./getActiveNote";
import { registerGetVaultInfo } from "./getVaultInfo";

export function registerTools(server: Server, app: App): void {
  registerListFiles(server, app);
  registerReadNote(server, app);
  registerCreateNote(server, app);
  registerUpdateNote(server, app);
  registerDeleteNote(server, app);
  registerSearchVault(server, app);
  registerGetActiveNote(server, app);
  registerGetVaultInfo(server, app);
}
```

### `src/server/tools/listFiles.ts`

```typescript
import { App, TFile, TFolder } from "obsidian";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const ListFilesSchema = z.object({
  path: z.string().optional().describe("Pasta do vault para listar. Raiz se omitido."),
  recursive: z.boolean().optional().default(false).describe("Listar subpastas recursivamente"),
});

export function registerListFiles(server: Server, app: App): void {
  server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => {
    // Este handler é compartilhado — cada tool adiciona ao array
    // Na prática, use o padrão de tool registration do SDK
    return { tools: [] }; // Placeholder — veja nota abaixo
  });

  // Registra a tool diretamente no handler de CallTool
  const originalHandler = server.getRequestHandler?.(CallToolRequestSchema);

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "list_files") {
      return originalHandler ? originalHandler(req, {}) : { content: [] };
    }

    const args = ListFilesSchema.parse(req.params.arguments ?? {});
    const targetPath = args.path ?? "/";
    const folder = app.vault.getAbstractFileByPath(targetPath === "/" ? "" : targetPath);

    const files: string[] = [];

    const collect = (f: TFolder | null) => {
      if (!f) return;
      for (const child of f.children) {
        if (child instanceof TFile) {
          files.push(child.path);
        } else if (child instanceof TFolder && args.recursive) {
          collect(child);
        } else if (child instanceof TFolder) {
          files.push(child.path + "/");
        }
      }
    };

    if (folder instanceof TFolder) {
      collect(folder);
    } else {
      // Raiz do vault
      app.vault.getAllLoadedFiles().forEach((f) => {
        if (f instanceof TFile && !args.recursive) files.push(f.path);
        else if (f instanceof TFile) files.push(f.path);
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ path: targetPath, files }, null, 2),
        },
      ],
    };
  });
}
```

> **Nota sobre registro de tools:** O SDK do MCP tem uma API de alto nível para registrar tools. O padrão recomendado é usar `server.tool()` se disponível na versão instalada, ou gerenciar manualmente os handlers `ListTools` e `CallTool`. Verifique a versão do SDK instalada com `npm show @modelcontextprotocol/sdk version`.

### Padrão recomendado para todas as tools (SDK v1+)

A partir do SDK v1, o padrão correto é:

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Em um arquivo central (tools/index.ts), configure os dois handlers uma vez:

export function registerTools(server: Server, app: App): void {
  // Lista de todas as tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "list_files",
        description: "Lista arquivos e pastas do vault Obsidian.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Caminho da pasta. Raiz se omitido." },
            recursive: { type: "boolean", description: "Listar recursivamente." },
          },
        },
      },
      {
        name: "read_note",
        description: "Lê o conteúdo de uma nota pelo caminho.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Caminho da nota (ex: Pasta/Nota.md)" },
          },
          required: ["path"],
        },
      },
      {
        name: "create_note",
        description: "Cria uma nova nota no vault.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Caminho completo com extensão (ex: Pasta/Nota.md)" },
            content: { type: "string", description: "Conteúdo em markdown." },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "update_note",
        description: "Atualiza o conteúdo de uma nota existente.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Caminho da nota." },
            content: { type: "string", description: "Novo conteúdo." },
            mode: {
              type: "string",
              enum: ["overwrite", "append", "prepend"],
              description: "Modo de escrita. Default: overwrite.",
            },
          },
          required: ["path", "content"],
        },
      },
      {
        name: "delete_note",
        description: "Deleta um arquivo do vault.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Caminho do arquivo a deletar." },
          },
          required: ["path"],
        },
      },
      {
        name: "search_vault",
        description: "Busca por texto em todas as notas do vault.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Texto a buscar." },
            case_sensitive: { type: "boolean", description: "Busca case-sensitive. Default: false." },
          },
          required: ["query"],
        },
      },
      {
        name: "get_active_note",
        description: "Retorna a nota atualmente aberta no editor do Obsidian.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_vault_info",
        description: "Retorna metadados do vault (nome, total de arquivos, etc).",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  // Dispatcher central de chamadas
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    switch (name) {
      case "list_files":       return await handleListFiles(app, args);
      case "read_note":        return await handleReadNote(app, args);
      case "create_note":      return await handleCreateNote(app, args);
      case "update_note":      return await handleUpdateNote(app, args);
      case "delete_note":      return await handleDeleteNote(app, args);
      case "search_vault":     return await handleSearchVault(app, args);
      case "get_active_note":  return await handleGetActiveNote(app);
      case "get_vault_info":   return await handleGetVaultInfo(app);
      default:
        throw new Error(`Tool desconhecida: ${name}`);
    }
  });
}
```

### Implementação das handlers individuais

```typescript
import { App, TFile, TFolder } from "obsidian";

// ─── list_files ───────────────────────────────────────────────────────────────
async function handleListFiles(app: App, args: any) {
  const targetPath: string = args?.path ?? "";
  const recursive: boolean = args?.recursive ?? false;

  const allFiles = app.vault.getAllLoadedFiles();
  const results: string[] = [];

  for (const f of allFiles) {
    const isInPath = targetPath === "" || f.path.startsWith(targetPath);
    if (!isInPath) continue;
    if (!recursive && f instanceof TFolder) {
      results.push(f.path + "/");
    } else if (f instanceof TFile) {
      results.push(f.path);
    }
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ files: results.sort() }, null, 2) }],
  };
}

// ─── read_note ────────────────────────────────────────────────────────────────
async function handleReadNote(app: App, args: any) {
  const path: string = args?.path;
  if (!path) throw new Error("Parâmetro 'path' é obrigatório.");

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);

  const content = await app.vault.read(file);
  return {
    content: [{ type: "text", text: content }],
  };
}

// ─── create_note ──────────────────────────────────────────────────────────────
async function handleCreateNote(app: App, args: any) {
  const path: string = args?.path;
  const content: string = args?.content ?? "";
  if (!path) throw new Error("Parâmetro 'path' é obrigatório.");

  const existing = app.vault.getAbstractFileByPath(path);
  if (existing) throw new Error(`Arquivo já existe: ${path}`);

  await app.vault.create(path, content);
  return {
    content: [{ type: "text", text: `Nota criada: ${path}` }],
  };
}

// ─── update_note ──────────────────────────────────────────────────────────────
async function handleUpdateNote(app: App, args: any) {
  const path: string = args?.path;
  const content: string = args?.content ?? "";
  const mode: string = args?.mode ?? "overwrite";
  if (!path) throw new Error("Parâmetro 'path' é obrigatório.");

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);

  if (mode === "overwrite") {
    await app.vault.modify(file, content);
  } else if (mode === "append") {
    const existing = await app.vault.read(file);
    await app.vault.modify(file, existing + "\n" + content);
  } else if (mode === "prepend") {
    const existing = await app.vault.read(file);
    await app.vault.modify(file, content + "\n" + existing);
  }

  return {
    content: [{ type: "text", text: `Nota atualizada (${mode}): ${path}` }],
  };
}

// ─── delete_note ──────────────────────────────────────────────────────────────
async function handleDeleteNote(app: App, args: any) {
  const path: string = args?.path;
  if (!path) throw new Error("Parâmetro 'path' é obrigatório.");

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);

  await app.vault.delete(file);
  return {
    content: [{ type: "text", text: `Arquivo deletado: ${path}` }],
  };
}

// ─── search_vault ─────────────────────────────────────────────────────────────
async function handleSearchVault(app: App, args: any) {
  const query: string = args?.query;
  const caseSensitive: boolean = args?.case_sensitive ?? false;
  if (!query) throw new Error("Parâmetro 'query' é obrigatório.");

  const results: { path: string; matches: number; excerpt: string }[] = [];
  const allFiles = app.vault.getMarkdownFiles();

  for (const file of allFiles) {
    const content = await app.vault.cachedRead(file);
    const searchIn = caseSensitive ? content : content.toLowerCase();
    const searchFor = caseSensitive ? query : query.toLowerCase();

    if (searchIn.includes(searchFor)) {
      const idx = searchIn.indexOf(searchFor);
      const start = Math.max(0, idx - 100);
      const end = Math.min(content.length, idx + query.length + 100);
      const excerpt = "..." + content.slice(start, end).replace(/\n/g, " ") + "...";
      const matchCount = (searchIn.match(new RegExp(searchFor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;

      results.push({ path: file.path, matches: matchCount, excerpt });
    }
  }

  results.sort((a, b) => b.matches - a.matches);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { query, total_files_matched: results.length, results: results.slice(0, 20) },
          null, 2
        ),
      },
    ],
  };
}

// ─── get_active_note ──────────────────────────────────────────────────────────
async function handleGetActiveNote(app: App) {
  const activeFile = app.workspace.getActiveFile();

  if (!activeFile) {
    return {
      content: [{ type: "text", text: "Nenhuma nota ativa no momento." }],
    };
  }

  const content = await app.vault.read(activeFile);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ path: activeFile.path, content }, null, 2),
      },
    ],
  };
}

// ─── get_vault_info ───────────────────────────────────────────────────────────
async function handleGetVaultInfo(app: App) {
  const allFiles = app.vault.getAllLoadedFiles();
  const markdownFiles = app.vault.getMarkdownFiles();
  const folders = allFiles.filter((f) => f instanceof TFolder);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            name: app.vault.getName(),
            total_files: allFiles.length,
            markdown_files: markdownFiles.length,
            folders: folders.length,
            adapter: (app.vault.adapter as any).basePath ?? "unknown",
          },
          null, 2
        ),
      },
    ],
  };
}
```

---

## 8. Implementação: Settings UI

### `src/settings/SettingsTab.ts`

```typescript
import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import McpServerPlugin from "../main";
import { randomBytes } from "crypto";

export class McpSettingsTab extends PluginSettingTab {
  plugin: McpServerPlugin;

  constructor(app: App, plugin: McpServerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "MCP Server Settings" });

    // Status atual
    const statusEl = containerEl.createEl("p");
    const updateStatus = () => {
      const running = this.plugin.mcpServer?.isRunning() ?? false;
      statusEl.setText(`Status: ${running ? "🟢 Rodando" : "🔴 Parado"}`);
    };
    updateStatus();

    // Porta
    new Setting(containerEl)
      .setName("Porta")
      .setDesc("Porta do servidor HTTP local. Padrão: 27123")
      .addText((text) =>
        text
          .setPlaceholder("27123")
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const port = parseInt(value);
            if (!isNaN(port) && port > 1024 && port < 65535) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
            }
          })
      );

    // Autenticação
    new Setting(containerEl)
      .setName("Autenticação por API Key")
      .setDesc("Exige o header Authorization: Bearer <api_key> em todas as requisições.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableAuth).onChange(async (value) => {
          this.plugin.settings.enableAuth = value;
          await this.plugin.saveSettings();
        })
      );

    // API Key
    new Setting(containerEl)
      .setName("API Key")
      .setDesc("Chave de autenticação. Copie para usar no seu IDE.")
      .addText((text) => {
        text
          .setValue(this.plugin.settings.apiKey)
          .setDisabled(true);
        text.inputEl.style.width = "300px";
        text.inputEl.style.fontFamily = "monospace";
      })
      .addButton((btn) => {
        btn.setButtonText("Copiar").onClick(() => {
          navigator.clipboard.writeText(this.plugin.settings.apiKey);
          new Notice("API Key copiada!");
        });
      })
      .addButton((btn) => {
        btn.setButtonText("Gerar nova").setWarning().onClick(async () => {
          this.plugin.settings.apiKey = randomBytes(32).toString("hex");
          await this.plugin.saveSettings();
          this.display(); // Re-render
          new Notice("Nova API Key gerada. Atualize a configuração no seu IDE.");
        });
      });

    // Auto-start
    new Setting(containerEl)
      .setName("Iniciar automaticamente")
      .setDesc("Inicia o servidor ao abrir o Obsidian.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoStart).onChange(async (value) => {
          this.plugin.settings.autoStart = value;
          await this.plugin.saveSettings();
        })
      );

    // URL do servidor
    const mcpUrl = `http://localhost:${this.plugin.settings.port}/mcp`;
    new Setting(containerEl)
      .setName("URL do MCP Server")
      .setDesc("Use essa URL na configuração do seu IDE.")
      .addText((text) => {
        text.setValue(mcpUrl).setDisabled(true);
        text.inputEl.style.width = "300px";
        text.inputEl.style.fontFamily = "monospace";
      })
      .addButton((btn) => {
        btn.setButtonText("Copiar URL").onClick(() => {
          navigator.clipboard.writeText(mcpUrl);
          new Notice("URL copiada!");
        });
      });

    // Configuração pronta para colar no IDE
    containerEl.createEl("h3", { text: "Configuração para IDEs" });

    const config = {
      mcpServers: {
        obsidian: {
          transport: {
            type: "http",
            url: mcpUrl,
            headers: this.plugin.settings.enableAuth
              ? { Authorization: `Bearer ${this.plugin.settings.apiKey}` }
              : undefined,
          },
        },
      },
    };

    const configText = containerEl.createEl("pre", {
      text: JSON.stringify(config, null, 2),
    });
    configText.style.cssText =
      "background: var(--background-secondary); padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto;";

    new Setting(containerEl).addButton((btn) => {
      btn.setButtonText("Copiar configuração JSON").onClick(() => {
        navigator.clipboard.writeText(JSON.stringify(config, null, 2));
        new Notice("Configuração copiada!");
      });
    });

    // Botões de controle
    containerEl.createEl("h3", { text: "Controles" });

    new Setting(containerEl)
      .setName("Servidor")
      .addButton((btn) => {
        btn.setButtonText("Iniciar").setCta().onClick(async () => {
          await this.plugin.startServer();
          updateStatus();
        });
      })
      .addButton((btn) => {
        btn.setButtonText("Parar").setWarning().onClick(async () => {
          await this.plugin.stopServer();
          updateStatus();
        });
      });
  }
}
```

---

## 9. Build e Testes

### Desenvolvimento (watch mode)

```bash
npm run dev
```

O esbuild vai observar mudanças e recompilar automaticamente para `main.js`. No Obsidian, use **Ctrl+R** (ou via plugin *Hot Reload*) para recarregar.

### Build para produção

```bash
npm run build
```

Gera `main.js` minificado, pronto para distribuição.

### Teste manual do servidor

Com o plugin ativo e o servidor rodando, você pode testar via curl:

```bash
# Health check
curl http://localhost:27123/health

# MCP Initialize (sem auth)
curl -X POST http://localhost:27123/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'

# Com autenticação
curl -X POST http://localhost:27123/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'

# Listar arquivos do vault
curl -X POST http://localhost:27123/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer SUA_API_KEY" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_files","arguments":{}}}'
```

### Usar o MCP Inspector (ferramenta oficial)

```bash
npx @modelcontextprotocol/inspector http://localhost:27123/mcp
```

Abre uma interface web para explorar e testar todas as tools interativamente.

---

## 10. Configuração nos MCP Clients

### Claude Desktop (`claude_desktop_config.json`)

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "obsidian": {
      "transport": {
        "type": "http",
        "url": "http://localhost:27123/mcp",
        "headers": {
          "Authorization": "Bearer SUA_API_KEY"
        }
      }
    }
  }
}
```

### VS Code com Cline / Roo Code

Nas configurações do Cline/Roo, adicione um servidor MCP do tipo HTTP com a URL `http://localhost:27123/mcp` e o header de autorização.

### Cursor

**`.cursor/mcp.json`** na raiz do projeto:

```json
{
  "mcpServers": {
    "obsidian": {
      "transport": {
        "type": "http",
        "url": "http://localhost:27123/mcp",
        "headers": {
          "Authorization": "Bearer SUA_API_KEY"
        }
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add --transport http obsidian http://localhost:27123/mcp \
  --header "Authorization: Bearer SUA_API_KEY"
```

---

## 11. Publicação na Community Plugins

### Pré-requisitos para submissão

- Código aberto no GitHub (repositório público)
- `manifest.json` válido e completo
- `README.md` explicando instalação e uso
- Sem dependências externas obrigatórias além do plugin em si
- Compatibilidade com as diretrizes da Obsidian

### Processo de publicação

1. **Crie um release no GitHub:**

```bash
# Crie os arquivos de release
git tag 1.0.0
git push origin 1.0.0

# No GitHub, crie um Release com:
# - main.js (build de produção)
# - manifest.json
# - styles.css (se houver)
```

2. **Fork do repositório de plugins:**

```bash
git clone https://github.com/obsidianmd/obsidian-releases
```

3. **Adicione seu plugin em `community-plugins.json`:**

```json
{
  "id": "obsidian-mcp-server",
  "name": "MCP Server",
  "author": "Seu Nome",
  "description": "Embeds an MCP Server inside Obsidian for AI IDE integration.",
  "repo": "seu-usuario/obsidian-mcp-server"
}
```

4. **Abra um Pull Request** no repositório `obsidianmd/obsidian-releases`.

---

## 12. Referências

### Documentação oficial

- [Obsidian Plugin API](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [Obsidian TypeScript API Reference](https://docs.obsidian.md/Reference/TypeScript+API/App)
- [MCP Specification — Transports](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [obsidian-sample-plugin (template)](https://github.com/obsidianmd/obsidian-sample-plugin)

### Projetos de referência para estudar

- [obsidian-mcp-plugin](https://github.com/aaronsb/obsidian-mcp-plugin) — Plugin que embute HTTP MCP server nativamente (mais próximo do que queremos)
- [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api) — Referência de como abrir um servidor HTTP dentro de um plugin Obsidian

### Pacotes npm relevantes

| Pacote | Versão | Uso |
|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.0.0` | SDK oficial MCP |
| `obsidian` | `latest` | Tipagens da API do Obsidian |
| `zod` | `^3.22.0` | Validação de schemas |
| `esbuild` | `^0.20.0` | Bundler |
| `typescript` | `^5.0.0` | Compilador |

---

> **Dica final:** Antes de iniciar do zero, clone e rode o `obsidian-mcp-plugin` localmente para ver o comportamento esperado. O código-fonte dele é a melhor documentação viva de como esse tipo de integração funciona na prática.
