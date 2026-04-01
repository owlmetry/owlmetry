import { API_URL } from "@/lib/api";

export const PLACEHOLDER = "YOUR_AGENT_KEY";

export function maskKey(key: string): string {
  if (!key || key === PLACEHOLDER) return PLACEHOLDER;
  const visible = key.slice(0, 18); // "owl_agent_" + 8 hex chars
  return `${visible}${"*".repeat(8)}`;
}
export const MCP_URL = `${API_URL}/mcp`;
const IS_DEV = process.env.NODE_ENV === "development";
export const SERVER_NAME = IS_DEV ? "owlmetry-local-dev" : "owlmetry";

export interface EditorScope {
  label: string;
  note?: string;
  /** Returns the config string with the key, MCP URL, and server name injected */
  config: (key: string, url: string, name: string) => string;
}

export interface EditorConfig {
  name: string;
  language: string;
  callout?: string;
  scopes: EditorScope[];
}

export const EDITORS: EditorConfig[] = [
  {
    name: "Claude Code",
    language: "bash",
    callout: "Verify the connection by typing `/mcp` in Claude Code.",
    scopes: [
      {
        label: "Add globally",
        note: "Available across all your projects — stored in your user config.",
        config: (key, url, name) =>
          `claude mcp add --transport http --scope user ${name} ${url} \\
  --header "Authorization: Bearer ${key}"`,
      },
      {
        label: "Just current project",
        note: "Shares the server with your team via `.mcp.json` in the project root.",
        config: (key, url, name) =>
          `claude mcp add --transport http ${name} ${url} \\
  --header "Authorization: Bearer ${key}"`,
      },
    ],
  },
  {
    name: "Codex",
    language: "toml",
    scopes: [
      {
        label: "Add globally",
        note: "Add to `~/.codex/config.toml`:",
        config: (key, url, name) =>
          `[mcp_servers.${name}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${key}" }`,
      },
      {
        label: "Just current project",
        note: "Add to `.codex/config.toml` in a trusted project:",
        config: (key, url, name) =>
          `[mcp_servers.${name}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${key}" }`,
      },
    ],
  },
  {
    name: "OpenCode",
    language: "json",
    scopes: [
      {
        label: "Default",
        note: "Add to `opencode.json` (or `opencode.jsonc`) in your project root:",
        config: (key, url, name) =>
          JSON.stringify(
            { $schema: "https://opencode.ai/config.json", mcp: { [name]: { type: "remote", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Cursor",
    language: "json",
    scopes: [
      {
        label: "Add globally",
        note: "Add to `~/.cursor/mcp.json`:",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
      {
        label: "Just current project",
        note: "Add to `.cursor/mcp.json` in your project:",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "VS Code",
    language: "json",
    callout: "You can also add servers via the Command Palette: **MCP: Add Server**.",
    scopes: [
      {
        label: "Project",
        note: "Add to `.vscode/mcp.json` in your project:",
        config: (key, url, name) =>
          JSON.stringify(
            { servers: { [name]: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Claude Desktop",
    language: "json",
    scopes: [
      {
        label: "Default",
        note: "Add to your Claude Desktop config:\n\n- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`\n- **Windows:** `%APPDATA%\\Claude\\claude_desktop_config.json`",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { type: "http", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Windsurf",
    language: "json",
    callout:
      "Windsurf uses `serverUrl` instead of `url` — this is different from other editors.\n\nYou can also access this file via Windsurf settings: Cascade > MCP Servers > View raw config.",
    scopes: [
      {
        label: "Default",
        note: "Add to `~/.codeium/windsurf/mcp_config.json`:",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { serverUrl: url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Zed",
    language: "json",
    callout: "Zed uses `context_servers` as the root key instead of `mcpServers`.",
    scopes: [
      {
        label: "Default",
        note: "Add to your Zed settings file (`~/.config/zed/settings.json`):",
        config: (key, url, name) =>
          JSON.stringify(
            { context_servers: { [name]: { url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "JetBrains",
    language: "json",
    callout: "Requires IDE version 2025.2 or later for streamable HTTP support.",
    scopes: [
      {
        label: "Default",
        note: "In any JetBrains IDE (IntelliJ, WebStorm, PyCharm, etc.):\n\n1. Open **Settings** > **Tools** > **AI Assistant** > **Model Context Protocol (MCP)**\n2. Click **+** to add a new server\n3. Enter the configuration:",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Cline",
    language: "json",
    scopes: [
      {
        label: "Default",
        note: "Open the Cline sidebar in VS Code, click the **MCP Servers** icon, then **Edit MCP Settings**:",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { type: "streamableHttp", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
  {
    name: "Roo Code",
    language: "json",
    scopes: [
      {
        label: "Add globally",
        note: "Edit via the Roo Code MCP server icon in the sidebar, then paste:",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { type: "streamable-http", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
      {
        label: "Just current project",
        note: "Add to `.roo/mcp.json` in your project root:",
        config: (key, url, name) =>
          JSON.stringify(
            { mcpServers: { [name]: { type: "streamable-http", url, headers: { Authorization: `Bearer ${key}` } } } },
            null,
            2,
          ),
      },
    ],
  },
];
