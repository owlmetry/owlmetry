"use client";

import { useState, useEffect } from "react";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Eye, EyeOff, LogIn, KeyRound } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/lib/api";

const PLACEHOLDER = "YOUR_AGENT_KEY";

// --- Editor config definitions ---

interface EditorConfig {
  name: string;
  language: string;
  note?: string;
  callout?: string;
  /** Returns the config string with the key injected */
  config: (key: string) => string;
}

const EDITORS: EditorConfig[] = [
  {
    name: "Claude Code",
    language: "bash",
    note: "Add `--scope user` to make it available across all projects, or `--scope project` to share it via `.mcp.json` in a repo.\n\nVerify the connection:\n\n```\n/mcp\n```",
    config: (key) =>
      `claude mcp add --transport http owlmetry https://api.owlmetry.com/mcp \\
  --header "Authorization: Bearer ${key}"`,
  },
  {
    name: "Cursor",
    language: "json",
    note: "Add to `.cursor/mcp.json` in your project (or `~/.cursor/mcp.json` for global):",
    config: (key) =>
      JSON.stringify(
        { mcpServers: { owlmetry: { type: "http", url: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
  },
  {
    name: "VS Code",
    language: "json",
    note: "Add to `.vscode/mcp.json` in your project:",
    callout: "You can also add servers via the Command Palette: **MCP: Add Server**.",
    config: (key) =>
      JSON.stringify(
        { servers: { owlmetry: { type: "streamable-http", url: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
  },
  {
    name: "Claude Desktop",
    language: "json",
    note: "Add to your Claude Desktop config:\n\n- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`\n- **Windows:** `%APPDATA%\\Claude\\claude_desktop_config.json`",
    config: (key) =>
      JSON.stringify(
        { mcpServers: { owlmetry: { type: "http", url: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
  },
  {
    name: "Windsurf",
    language: "json",
    note: "Add to `~/.codeium/windsurf/mcp_config.json`:",
    callout: "Windsurf uses `serverUrl` instead of `url` — this is different from other editors.\n\nYou can also access this file via Windsurf settings: **Cascade** > **MCP Servers** > **View raw config**.",
    config: (key) =>
      JSON.stringify(
        { mcpServers: { owlmetry: { type: "http", serverUrl: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
  },
  {
    name: "Zed",
    language: "json",
    note: "Add to your Zed settings file (`~/.config/zed/settings.json`):",
    callout: "Zed uses `context_servers` as the root key instead of `mcpServers`, and nests config under `settings`.",
    config: (key) =>
      JSON.stringify(
        { context_servers: { owlmetry: { settings: { url: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } } },
        null,
        2,
      ),
  },
  {
    name: "JetBrains",
    language: "json",
    note: "In any JetBrains IDE (IntelliJ, WebStorm, PyCharm, etc.):\n\n1. Open **Settings** > **Tools** > **AI Assistant** > **Model Context Protocol (MCP)**\n2. Click **+** to add a new server\n3. Enter the configuration:",
    callout: "JetBrains currently uses SSE transport. Streamable HTTP support may vary by IDE version — check the [JetBrains MCP docs](https://www.jetbrains.com/help/ai-assistant/mcp.html) for the latest.",
    config: (key) =>
      JSON.stringify(
        { mcpServers: { owlmetry: { type: "sse", url: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
  },
  {
    name: "Cline",
    language: "json",
    note: "Open the Cline sidebar in VS Code, click the **MCP Servers** icon, then **Edit MCP Settings**:",
    config: (key) =>
      JSON.stringify(
        { mcpServers: { owlmetry: { type: "http", url: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
  },
  {
    name: "Roo Code",
    language: "json",
    note: "Add to `.roo/mcp.json` in your project root (or edit global settings via the Roo Code server icon):",
    config: (key) =>
      JSON.stringify(
        { mcpServers: { owlmetry: { type: "streamable-http", url: "https://api.owlmetry.com/mcp", headers: { Authorization: `Bearer ${key}` } } } },
        null,
        2,
      ),
  },
];

function maskKey(key: string): string {
  if (!key || key === PLACEHOLDER) return PLACEHOLDER;
  // Show prefix + first 8 chars, mask the rest
  const visible = key.slice(0, 18); // "owl_agent_" + 8 hex chars
  return `${visible}${"*".repeat(8)}`;
}

export function McpSetupInstructions() {
  const { user, teams, isLoading, mutate } = useUser();
  const [keyVisible, setKeyVisible] = useState(false);
  const [lazyCreating, setLazyCreating] = useState(false);

  // Determine auth state
  const isAuthenticated = !!user;
  const firstTeam = teams?.[0];
  const defaultKey = firstTeam?.default_agent_key;
  const activeKey = defaultKey || PLACEHOLDER;
  const displayKey = keyVisible ? activeKey : maskKey(activeKey);
  const hasRealKey = activeKey !== PLACEHOLDER;

  // Auto lazy-create if authenticated but no key
  useEffect(() => {
    if (!isAuthenticated || !firstTeam || defaultKey || lazyCreating) return;

    setLazyCreating(true);
    api
      .post<{ secret: string; created: boolean }>("/v1/auth/default-agent-key", {
        team_id: firstTeam.id,
      })
      .then(() => {
        mutate(); // Refresh /v1/auth/me to pick up the new key
      })
      .catch(() => {
        // Silently fail — user can still copy configs with placeholder
      })
      .finally(() => setLazyCreating(false));
  }, [isAuthenticated, firstTeam, defaultKey, lazyCreating, mutate]);

  if (isLoading) {
    return (
      <div className="my-6 rounded-lg border border-border bg-card p-6 animate-pulse">
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="mt-4 h-32 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="my-6">
      {/* Auth status banner */}
      {!isAuthenticated ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3">
          <LogIn className="h-4 w-4 shrink-0 text-blue-400" />
          <p className="flex-1 text-sm text-blue-200">
            Sign in to get your API key pre-filled in all editor configs below.
          </p>
          <a
            href="/login?redirect=/docs/mcp/setup"
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500"
          >
            Sign in
          </a>
        </div>
      ) : hasRealKey ? (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <KeyRound className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="flex-1 text-sm text-emerald-200">
              Your agent API key is pre-filled in all configs below.
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setKeyVisible(!keyVisible)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-emerald-300 transition-colors hover:bg-emerald-500/20"
                title={keyVisible ? "Hide key" : "Show key"}
              >
                {keyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {keyVisible ? "Hide" : "Show"}
              </button>
              <CopyButton text={activeKey} />
            </div>
          </div>
          {/* Key display */}
          <div className="mt-2 flex items-center gap-2 rounded bg-black/20 px-3 py-1.5 font-mono text-xs text-emerald-300/80">
            {displayKey}
          </div>
        </div>
      ) : lazyCreating ? (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 animate-pulse">
          <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Creating your default agent key...</p>
        </div>
      ) : null}

      {/* Editor config tabs */}
      <Tabs items={EDITORS.map((e) => e.name)}>
        {EDITORS.map((editor) => {
          const configText = editor.config(activeKey);
          const configDisplay = editor.config(displayKey);
          return (
            <Tab key={editor.name} value={editor.name}>
              {editor.note && (
                <div className="mb-3 text-sm prose-invert [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs">
                  {editor.note.split("\n").map((line, i) => {
                    if (line.startsWith("```")) return null;
                    if (line.startsWith("- **")) {
                      const match = line.match(/- \*\*(.+?)\*\* `(.+?)`/);
                      if (match) return <p key={i}><strong>{match[1]}</strong> <code>{match[2]}</code></p>;
                    }
                    if (line.match(/^\d+\./)) {
                      return <p key={i}>{line}</p>;
                    }
                    if (line.trim() === "") return null;
                    return <p key={i}>{line}</p>;
                  })}
                </div>
              )}
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border border-border bg-fd-code-background p-4 text-sm">
                  <code>{configDisplay}</code>
                </pre>
                <div className="absolute right-2 top-2">
                  <CopyButton text={configText} />
                </div>
              </div>
              {editor.callout && (
                <div className="mt-3 rounded-lg border border-fd-border bg-fd-card px-4 py-3 text-sm text-fd-muted-foreground">
                  {editor.callout}
                </div>
              )}
            </Tab>
          );
        })}
      </Tabs>
    </div>
  );
}
