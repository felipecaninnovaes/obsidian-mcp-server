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

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 18 LTS or later
- npm (bundled with Node.js)

### Steps

```bash
# Clone the repository
git clone https://github.com/felipecn/obsidian-mcp-server.git
cd obsidian-mcp-server

# Install dependencies
npm install

# Development build (watch mode — rebuilds on file changes)
npm run dev

# Production build (type-checked, minified)
npm run build
```

The production build outputs `main.js` at the project root. Copy `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder to test locally.

### Linting

```bash
npm run lint
```

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

## Connecting an MCP Client

Once the server is running, it is available at:

```
http://localhost:27123/mcp
```

Pass the API key as a `Bearer` token in the `Authorization` header:

```
Authorization: Bearer <your-api-key>
```

### Example — Claude Desktop (`claude_desktop_config.json`)

Claude Desktop only supports stdio transport. Use [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) as a proxy.

**Step 1 — install `mcp-remote` globally** (one-time):

```bash
npm install -g mcp-remote
```

> **Windows note:** do not use `npx mcp-remote`. If Node.js is installed in a path with spaces (e.g. `D:\Program Files\nodejs`), Claude Desktop will fail to launch `npx` correctly. Installing globally avoids this.

**Step 2 — add to `claude_desktop_config.json`:**

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

> **No authentication?** If you disable *Require authentication* in the plugin settings, omit the `--header` arguments. Only do this if *Network access* is also off.

### Example — Claude Code / other Streamable HTTP clients

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

### Health check

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
- CORS is restricted to `localhost` and `127.0.0.1` origins.
- All vault paths are validated and sanitized — absolute paths and directory traversal (`../`) are rejected.

---

## License

0BSD — see [LICENSE](LICENSE).
