"use client";

import { useState, useEffect } from "react";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { Eye, EyeOff, LogIn, KeyRound } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { CopyButton } from "@/components/copy-button";
import { api } from "@/lib/api";
import { EDITORS, PLACEHOLDER, MCP_URL, SERVER_NAME } from "@/lib/mcp-editors";

function maskKey(key: string): string {
  if (!key || key === PLACEHOLDER) return PLACEHOLDER;
  // Show prefix + first 8 chars, mask the rest
  const visible = key.slice(0, 18); // "owl_agent_" + 8 hex chars
  return `${visible}${"*".repeat(8)}`;
}

function renderNote(note: string) {
  return (
    <div className="mb-3 text-sm prose-invert [&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-xs">
      {note.split("\n").map((line, i) => {
        if (line.startsWith("```")) return null;
        if (line.startsWith("- **")) {
          const match = line.match(/- \*\*(.+?)\*\* `(.+?)`/);
          if (match)
            return (
              <p key={i}>
                <strong>{match[1]}</strong> <code>{match[2]}</code>
              </p>
            );
        }
        if (line.match(/^\d+\./)) {
          return <p key={i}>{line}</p>;
        }
        if (line.trim() === "") return null;
        return <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export function McpSetupInstructions() {
  const { user, teams, isLoading, mutate } = useUser();
  const [keyVisible, setKeyVisible] = useState(false);
  const [lazyCreating, setLazyCreating] = useState(false);
  const [scopeSelections, setScopeSelections] = useState<Record<string, number>>({});

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
          const scopeIdx = scopeSelections[editor.name] ?? 0;
          const scope = editor.scopes[scopeIdx];
          const configText = scope.config(activeKey, MCP_URL, SERVER_NAME);
          const configDisplay = scope.config(displayKey, MCP_URL, SERVER_NAME);
          return (
            <Tab key={editor.name} value={editor.name}>
              {/* Scope toggle — only shown when editor has multiple scopes */}
              {editor.scopes.length > 1 && (
                <div className="mb-3 inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                  {editor.scopes.map((s, i) => (
                    <button
                      key={s.label}
                      type="button"
                      onClick={() =>
                        setScopeSelections((prev) => ({ ...prev, [editor.name]: i }))
                      }
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        scopeIdx === i
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Note */}
              {scope.note && renderNote(scope.note)}

              {/* Config code block */}
              <div className="relative">
                <pre className="overflow-x-auto rounded-lg border border-border bg-fd-code-background p-4 text-sm">
                  <code>{configDisplay}</code>
                </pre>
                <div className="absolute right-2 top-2">
                  <CopyButton text={configText} />
                </div>
              </div>

              {/* Callout */}
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
