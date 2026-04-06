# Obsidian MCP Server Plugin — Guia Completo de Desenvolvimento

> Plugin nativo que embute um MCP Server HTTP diretamente no Obsidian.
> O usuário instala → configura a URL no IDE → conecta. Sem dependências externas.

---

## Estado atual do projeto

| Arquivo / Módulo | Status |
|---|---|
| `manifest.json` | ✅ Configurado |
| `package.json` | ✅ Configurado |
| `src/types.ts` | ✅ Implementado |
| `src/main.ts` | ✅ Implementado |
| `src/settings/SettingsTab.ts` | ✅ Implementado |
| `src/server/McpServer.ts` | 🚧 Stub — HTTP + MCP SDK pendente |
| `src/server/tools/index.ts` | 🚧 Stub — tools pendentes |
| Tools individuais (8 arquivos) | 🔲 Não criados |

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

### Instalar dependências do projeto

As dependências já estão instaladas. Para referência:

```bash
# SDK oficial do MCP (Anthropic)
npm install @modelcontextprotocol/sdk

# Zod para validação de schemas das tools
npm install zod
```

> **Nota:** O projeto usa `builtinModules` de `node:module` (built-in do Node.js/Electron), sem o pacote npm `builtin-modules`.

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

### Estado atual

```
obsidian-mcp-server/
├── src/
│   ├── main.ts                  ✅ Plugin entry point
│   ├── types.ts                 ✅ Tipos e settings
│   ├── server/
│   │   ├── McpServer.ts         🚧 Stub — implementação pendente
│   │   └── tools/
│   │       └── index.ts         🚧 Stub — registrar tools aqui
│   └── settings/
│       └── SettingsTab.ts       ✅ UI de configurações
├── manifest.json                ✅
├── package.json                 ✅
├── tsconfig.json                (template original — ver seção 4)
├── esbuild.config.mjs           (template original — ver seção 4)
└── styles.css
```

### Estrutura alvo (completa)

```
src/
├── main.ts
├── types.ts
├── server/
│   ├── McpServer.ts
│   └── tools/
│       ├── index.ts             # Registra e despacha todas as tools
│       ├── listFiles.ts         🔲
│       ├── readNote.ts          🔲
│       ├── createNote.ts        🔲
│       ├── updateNote.ts        🔲
│       ├── deleteNote.ts        🔲
│       ├── searchVault.ts       🔲
│       ├── getActiveNote.ts     🔲
│       └── getVaultInfo.ts      🔲
└── settings/
    └── SettingsTab.ts
```

---

## 4. Configuração dos Arquivos Base

### `manifest.json` ✅

```json
{
  "id": "obsidian-mcp-server",
  "name": "MCP Server",
  "version": "1.0.0",
  "minAppVersion": "1.4.0",
  "description": "Embeds an MCP Server inside Obsidian. Connect any MCP-compatible IDE or AI client to your vault.",
  "author": "Felipe CN",
  "authorUrl": "https://github.com/felipecn",
  "isDesktopOnly": true
}
```

> **`isDesktopOnly: true` é obrigatório** — o plugin usa APIs do Node.js (`http`, `net`) que não existem no Obsidian Mobile.

### `package.json` ✅

```json
{
  "name": "obsidian-mcp-server",
  "version": "1.0.0",
  "description": "MCP Server plugin for Obsidian",
  "main": "main.js",
  "type": "module",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production",
    "version": "node version-bump.mjs && git add manifest.json versions.json",
    "lint": "eslint ."
  },
  "keywords": ["obsidian", "mcp", "ai"],
  "license": "0-BSD",
  "devDependencies": {
    "@eslint/js": "9.30.1",
    "@types/node": "^16.11.6",
    "esbuild": "0.25.5",
    "eslint-plugin-obsidianmd": "0.1.9",
    "globals": "14.0.0",
    "jiti": "2.6.1",
    "tslib": "2.4.0",
    "typescript": "^5.8.3",
    "typescript-eslint": "8.35.1"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.28.0",
    "obsidian": "latest",
    "zod": "^4.3.6"
  }
}
```

### `tsconfig.json` (template original)

O arquivo atual usa as configurações do template `obsidian-sample-plugin`:

```json
{
  "compilerOptions": {
    "baseUrl": "src",
    "inlineSourceMap": true,
    "inlineSources": true,
    "module": "ESNext",
    "target": "ES6",
    "allowJs": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "noImplicitReturns": true,
    "moduleResolution": "node",
    "importHelpers": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "strictNullChecks": true,
    "strictBindCallApply": true,
    "allowSyntheticDefaultImports": true,
    "useUnknownInCatchVariables": true,
    "lib": ["DOM", "ES5", "ES6", "ES7"]
  },
  "include": ["src/**/*.ts"]
}
```

> **Nota:** `baseUrl: "src"` significa que imports dentro de `src/` são relativos a essa pasta. Imports de `../types` de dentro de `src/server/` continuam funcionando normalmente.

### `esbuild.config.mjs` (template original)

```javascript
import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/`;

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
    ...builtinModules,  // inclui 'http', 'net', 'stream', 'crypto', etc.
  ],
  format: "cjs",
  target: "es2018",
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

> **`...builtinModules`** no array `external` é crítico. Diz ao esbuild para não tentar empacotar módulos nativos do Node.js — eles são resolvidos pelo Electron em runtime. O projeto usa `builtinModules` de `node:module` (nativo), sem o pacote npm `builtin-modules`.

### `src/types.ts` ✅

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

### `src/main.ts` ✅

```typescript
import { Plugin, Notice } from "obsidian";
import { randomBytes } from "crypto";
import { DEFAULT_SETTINGS, McpServerSettings } from "./types";
import { ObsidianMcpServer } from "./server/McpServer";
import { McpSettingsTab } from "./settings/SettingsTab";

export default class McpServerPlugin extends Plugin {
  settings: McpServerSettings;
  mcpServer: ObsidianMcpServer | null = null;

  async onload() {
    await this.loadSettings();

    if (!this.settings.apiKey) {
      this.settings.apiKey = randomBytes(32).toString("hex");
      await this.saveSettings();
    }

    this.addSettingTab(new McpSettingsTab(this.app, this));

    this.addRibbonIcon("plug", "MCP Server", async () => {
      if (this.mcpServer?.isRunning()) {
        await this.stopServer();
      } else {
        await this.startServer();
      }
    });

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

    if (this.settings.autoStart) {
      await this.startServer();
    }
  }

  async onunload() {
    await this.stopServer();
  }

  async startServer() {
    if (this.mcpServer?.isRunning()) return;
    this.mcpServer = new ObsidianMcpServer(this.app, this.settings);
    await this.mcpServer.start();
    new Notice(`MCP Server started on port ${this.settings.port}`);
  }

  async stopServer() {
    if (!this.mcpServer?.isRunning()) return;
    await this.mcpServer.stop();
    new Notice("MCP Server stopped");
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<McpServerSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
```

---

## 6. Implementação: MCP Server HTTP

### `src/server/McpServer.ts` 🚧

Estado atual — stub com interface pública definida:

```typescript
import { App } from "obsidian";
import { McpServerSettings } from "../types";

export class ObsidianMcpServer {
  private app: App;
  private settings: McpServerSettings;
  private running = false;

  constructor(app: App, settings: McpServerSettings) {
    this.app = app;
    this.settings = settings;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    // TODO: iniciar HTTP server com Streamable HTTP transport do MCP SDK
    // - criar McpServer do @modelcontextprotocol/sdk
    // - registrar tools via registerTools(mcpServer, this.app)
    // - criar http.createServer que roteia POST /mcp e GET /mcp
    // - aplicar autenticação via apiKey se settings.enableAuth
    this.running = true;
  }

  async stop(): Promise<void> {
    // TODO: encerrar o http.Server e o McpServer transport
    this.running = false;
  }
}
```

### Implementação completa (referência)

```typescript
import { App } from "obsidian";
import { McpServerSettings } from "../types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTools } from "./tools/index";
import * as http from "http";

export class ObsidianMcpServer {
  private app: App;
  private settings: McpServerSettings;
  private httpServer: http.Server | null = null;
  private mcpServer: McpServer | null = null;
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
    this.mcpServer = new McpServer({
      name: "obsidian-mcp-server",
      version: "1.0.0",
    });

    registerTools(this.mcpServer, this.app);

    this.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => Math.random().toString(36).slice(2),
    });

    await this.mcpServer.connect(this.transport);

    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id");
      res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (this.settings.enableAuth) {
        const authHeader = req.headers["authorization"];
        if (authHeader !== `Bearer ${this.settings.apiKey}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }

      if (req.url === "/health" || req.url === "/") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          plugin: "obsidian-mcp-server",
          version: "1.0.0",
          vault: this.app.vault.getName(),
        }));
        return;
      }

      if (req.url === "/mcp" || req.url?.startsWith("/mcp?")) {
        await this.transport!.handleRequest(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
    });

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
  }
}
```

> **Imports do SDK v1.28+:** A classe é `McpServer` (de `server/mcp.js`), não `Server` (de `server/index.js`). Confirme os exports da versão instalada antes de importar.

---

## 7. Implementação: Vault Tools

### `src/server/tools/index.ts` 🚧

Estado atual — stub com interface pública e TODOs:

```typescript
import { App } from "obsidian";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerTools(server: McpServer, app: App): void {
  // TODO: implementar e registrar cada tool
  // listFiles(server, app)
  // readNote(server, app)
  // createNote(server, app)
  // updateNote(server, app)
  // deleteNote(server, app)
  // searchVault(server, app)
  // getActiveNote(server, app)
  // getVaultInfo(server, app)
  void app;
  void server;
}
```

### Implementação completa (referência)

O SDK v1+ expõe `server.tool()` para registrar tools diretamente:

```typescript
import { App, TFile, TFolder } from "obsidian";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerTools(server: McpServer, app: App): void {
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

### Padrão de cada tool (SDK v1+ com `server.tool()`)

```typescript
// Exemplo: listFiles.ts
export function registerListFiles(server: McpServer, app: App): void {
  server.tool(
    "list_files",
    "Lista arquivos e pastas do vault Obsidian.",
    {
      path: z.string().optional().describe("Pasta do vault para listar. Raiz se omitido."),
      recursive: z.boolean().optional().default(false),
    },
    async ({ path: targetPath = "", recursive }) => {
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
  );
}
```

### Handlers das demais tools (referência)

```typescript
// read_note
server.tool("read_note", "Lê o conteúdo de uma nota pelo caminho.",
  { path: z.string().describe("Caminho da nota (ex: Pasta/Nota.md)") },
  async ({ path }) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);
    const content = await app.vault.read(file);
    return { content: [{ type: "text", text: content }] };
  }
);

// create_note
server.tool("create_note", "Cria uma nova nota no vault.",
  { path: z.string(), content: z.string() },
  async ({ path, content }) => {
    if (app.vault.getAbstractFileByPath(path)) throw new Error(`Já existe: ${path}`);
    await app.vault.create(path, content);
    return { content: [{ type: "text", text: `Nota criada: ${path}` }] };
  }
);

// update_note
server.tool("update_note", "Atualiza o conteúdo de uma nota existente.",
  {
    path: z.string(),
    content: z.string(),
    mode: z.enum(["overwrite", "append", "prepend"]).default("overwrite"),
  },
  async ({ path, content, mode }) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);
    if (mode === "overwrite") {
      await app.vault.modify(file, content);
    } else if (mode === "append") {
      await app.vault.modify(file, (await app.vault.read(file)) + "\n" + content);
    } else {
      await app.vault.modify(file, content + "\n" + (await app.vault.read(file)));
    }
    return { content: [{ type: "text", text: `Nota atualizada (${mode}): ${path}` }] };
  }
);

// delete_note
server.tool("delete_note", "Deleta um arquivo do vault.",
  { path: z.string() },
  async ({ path }) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Arquivo não encontrado: ${path}`);
    await app.vault.delete(file);
    return { content: [{ type: "text", text: `Arquivo deletado: ${path}` }] };
  }
);

// search_vault
server.tool("search_vault", "Busca por texto em todas as notas do vault.",
  { query: z.string(), case_sensitive: z.boolean().optional().default(false) },
  async ({ query, case_sensitive }) => {
    const results: { path: string; matches: number; excerpt: string }[] = [];
    for (const file of app.vault.getMarkdownFiles()) {
      const content = await app.vault.cachedRead(file);
      const searchIn = case_sensitive ? content : content.toLowerCase();
      const searchFor = case_sensitive ? query : query.toLowerCase();
      if (!searchIn.includes(searchFor)) continue;
      const idx = searchIn.indexOf(searchFor);
      const excerpt = "..." + content.slice(Math.max(0, idx - 100), idx + query.length + 100).replace(/\n/g, " ") + "...";
      const matchCount = (searchIn.match(new RegExp(searchFor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length;
      results.push({ path: file.path, matches: matchCount, excerpt });
    }
    results.sort((a, b) => b.matches - a.matches);
    return {
      content: [{ type: "text", text: JSON.stringify({ query, total_files_matched: results.length, results: results.slice(0, 20) }, null, 2) }],
    };
  }
);

// get_active_note
server.tool("get_active_note", "Retorna a nota atualmente aberta no editor do Obsidian.",
  {},
  async () => {
    const activeFile = app.workspace.getActiveFile();
    if (!activeFile) return { content: [{ type: "text", text: "Nenhuma nota ativa no momento." }] };
    const content = await app.vault.read(activeFile);
    return { content: [{ type: "text", text: JSON.stringify({ path: activeFile.path, content }, null, 2) }] };
  }
);

// get_vault_info
server.tool("get_vault_info", "Retorna metadados do vault.",
  {},
  async () => {
    const allFiles = app.vault.getAllLoadedFiles();
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          name: app.vault.getName(),
          total_files: allFiles.length,
          markdown_files: app.vault.getMarkdownFiles().length,
          folders: allFiles.filter((f) => f instanceof TFolder).length,
          adapter: (app.vault.adapter as { basePath?: string }).basePath ?? "unknown",
        }, null, 2),
      }],
    };
  }
);
```

---

## 8. Implementação: Settings UI

### `src/settings/SettingsTab.ts` ✅

```typescript
import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type McpServerPlugin from "../main";

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

    new Setting(containerEl)
      .setName("Port")
      .setDesc("Port the MCP HTTP server listens on (default: 27123).")
      .addText((text) =>
        text
          .setPlaceholder("27123")
          .setValue(String(this.plugin.settings.port))
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.port = port;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("API Key")
      .setDesc("Secret key required by MCP clients to authenticate.")
      .addText((text) =>
        text
          .setPlaceholder("auto-generated")
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Copy").onClick(() => {
          navigator.clipboard.writeText(this.plugin.settings.apiKey);
          new Notice("API key copied!");
        })
      );

    new Setting(containerEl)
      .setName("Require authentication")
      .setDesc("Reject requests that do not include the API key.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAuth)
          .onChange(async (value) => {
            this.plugin.settings.enableAuth = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-start on load")
      .setDesc("Start the MCP server automatically when Obsidian opens.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoStart)
          .onChange(async (value) => {
            this.plugin.settings.autoStart = value;
            await this.plugin.saveSettings();
          })
      );

    const statusDesc = this.plugin.mcpServer?.isRunning()
      ? `Running on http://localhost:${this.plugin.settings.port}/mcp`
      : "Stopped";

    new Setting(containerEl)
      .setName("Server status")
      .setDesc(statusDesc)
      .addButton((btn) => {
        const running = this.plugin.mcpServer?.isRunning() ?? false;
        btn.setButtonText(running ? "Stop" : "Start").onClick(async () => {
          if (running) {
            await this.plugin.stopServer();
          } else {
            await this.plugin.startServer();
          }
          this.display();
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

O esbuild observa mudanças e recompila automaticamente para `main.js`. No Obsidian, use **Ctrl+R** (ou o plugin *Hot Reload*) para recarregar.

### Build para produção

```bash
npm run build
```

Gera `main.js` minificado, pronto para distribuição.

### Teste manual do servidor

Com o plugin ativo e o servidor rodando:

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

### MCP Inspector (ferramenta oficial)

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
git tag 1.0.0
git push origin 1.0.0
# No GitHub, crie um Release com: main.js, manifest.json, styles.css
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
  "author": "Felipe CN",
  "description": "Embeds an MCP Server inside Obsidian for AI IDE integration.",
  "repo": "felipecn/obsidian-mcp-server"
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

### Projetos de referência

- [obsidian-mcp-plugin](https://github.com/aaronsb/obsidian-mcp-plugin) — Plugin que embute HTTP MCP server nativamente
- [obsidian-local-rest-api](https://github.com/coddingtonbear/obsidian-local-rest-api) — Referência de como abrir um servidor HTTP dentro de um plugin Obsidian

### Pacotes npm instalados

| Pacote | Versão instalada | Uso |
|---|---|---|
| `@modelcontextprotocol/sdk` | `^1.28.0` | SDK oficial MCP |
| `obsidian` | `latest` | Tipagens da API do Obsidian |
| `zod` | `^4.3.6` | Validação de schemas das tools |
| `esbuild` | `0.25.5` | Bundler |
| `typescript` | `^5.8.3` | Compilador |
| `@types/node` | `^16.11.6` | Tipagens Node.js |
