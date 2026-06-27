# Obsidian MCP Server

An [Obsidian](https://obsidian.md) community plugin that embeds an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) HTTP server directly inside Obsidian, allowing any MCP-compatible IDE or AI client to read and write notes in your vault.

> **Desktop only** — requires Obsidian 1.4.0 or later.

---

## Features

The plugin exposes the following MCP tools to connected clients:

| Tool | Description |
|---|---|
| `list_files` | List files and folders in the vault |
| `read_note` | Read the content of a note by path |
| `create_note` | Create a new note |
| `update_note` | Update an existing note (overwrite / append / prepend) |
| `delete_note` | Delete a file from the vault |
| `search_vault` | Full-text search across all markdown notes |
| `get_active_note` | Return the note currently open in the editor |
| `get_vault_info` | Return vault metadata (file count, folders, etc.) |

---

## Architecture Overview

Most standalone MCP servers use `stdio` for transport, requiring the client to spawn the server as a subprocess. Since Obsidian is the main application process and plugins cannot be launched as separate standalone processes by an IDE, this plugin uses **Streamable HTTP**.

The plugin runs a local HTTP server directly inside Obsidian. AI clients connect to this server via an HTTP URL (e.g., `http://localhost:27123/mcp`) using Server-Sent Events (SSE) or Streamable HTTP. This allows secure, cross-process communication between your IDE and your vault.

---

## Installation

### From GitHub Releases (recommended)

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. Copy the three files into your vault plugin folder:
   ```
   <Vault>/.obsidian/plugins/obsidian-mcp-server/
   ```
3. Reload Obsidian and go to **Settings → Community plugins**.
4. Enable **MCP Server**.

### BRAT (beta testing)

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) and add this repository URL to test pre-release builds.

---

## Configuration

After enabling the plugin, open **Settings → MCP Server**:

| Option | Default | Description |
|---|---|---|
| **Port** | `27123` | Port the HTTP server listens on |
| **API Key** | auto-generated | Secret key required by MCP clients |
| **Require authentication** | `true` | Reject requests without the API key |
| **Auto-start on load** | `true` | Start the server when Obsidian opens |
| **Network access** | `false` | Bind to `0.0.0.0` to accept connections from other devices on the network |

The **API Key** is auto-generated on first load. Copy it from the settings tab using the **Copy** button.

---

## Connecting MCP Clients

Once the server is running, it is available at `http://localhost:27123/mcp`. You must pass your API key as a Bearer token in the `Authorization` header.

### Claude Desktop

Claude Desktop only supports `stdio` transport natively. To connect it to an HTTP MCP server, use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a proxy.

**Step 1 — Install `mcp-remote` globally** (one-time):
```bash
npm install -g mcp-remote
```
*(Windows note: Installing globally avoids issues if Node.js is installed in a path with spaces).*

**Step 2 — Add to your Claude Desktop configuration**:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "mcp-remote",
      "args": [
        "http://localhost:27123/sse",
        "--header",
        "Authorization:Bearer <your-api-key>"
      ]
    }
  }
}
```

### Cursor

Create or edit the **`.cursor/mcp.json`** file in the root of your project:

```json
{
  "mcpServers": {
    "obsidian": {
      "transport": {
        "type": "http",
        "url": "http://localhost:27123/mcp",
        "headers": {
          "Authorization": "Bearer <your-api-key>"
        }
      }
    }
  }
}
```

### VS Code (Cline / Roo Code)

In your extension settings for Cline or Roo Code, add an MCP server of type **HTTP** with the URL `http://localhost:27123/mcp` and include the Authorization header with your API key.

### Claude Code (CLI)

```bash
claude mcp add --transport http obsidian http://localhost:27123/mcp \
  --header "Authorization: Bearer <your-api-key>"
```

### Other Streamable HTTP Clients

```json
{
  "mcpServers": {
    "obsidian": {
      "url": "http://localhost:27123/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

---

## Testing & Troubleshooting

### MCP Inspector

You can test the server interactively using the official MCP Inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:27123/mcp
```
*Note: You may need to temporarily disable "Require authentication" in Obsidian settings to use the inspector easily.*

### Health Check

```
GET http://localhost:27123/health
```

Returns `{"status":"ok","version":"1.0.0"}` — no authentication required.

---

## Commands

| Command | Description |
|---|---|
| `Start MCP Server` | Start the server |
| `Stop MCP Server` | Stop the server |
| `Copy MCP Server URL` | Copy the server URL to clipboard |

The ribbon icon (plug) also toggles the server on/off.

---

## Security

- By default the server binds to `127.0.0.1` (localhost only).
- Authentication is **enabled by default**. Disabling it is only safe if `Network access` is also off.
- Enabling `Network access` without authentication is blocked at startup.
- CORS is restricted to allow secure connections from local tools.
- All vault paths are validated and sanitized — absolute paths and directory traversal (`../`) are rejected.

---

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 18 LTS or later
- npm (bundled with Node.js)

### Steps

```bash
git clone https://github.com/felipecn/obsidian-mcp-server.git
cd obsidian-mcp-server
npm install
npm run dev # Watch mode for development
npm run build # Production build
npm run lint # Linting
```

---

## License

0BSD — see [LICENSE](LICENSE).
