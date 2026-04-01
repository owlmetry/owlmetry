"use client";

import { useState, useEffect } from "react";
import { EDITORS, PLACEHOLDER, MCP_URL, SERVER_NAME } from "@/lib/mcp-editors";
import { useUser } from "@/hooks/use-user";
import { api } from "@/lib/api";
import { TerminalCopyButton } from "@/components/terminal-copy-button";

export function LandingMcpSetup() {
  const { user, teams, mutate } = useUser();
  const [selectedEditor, setSelectedEditor] = useState(0);
  const [lazyCreating, setLazyCreating] = useState(false);

  const isAuthenticated = !!user;
  const firstTeam = teams?.[0];
  const defaultKey = firstTeam?.default_agent_key;

  // Auto lazy-create if authenticated but no key
  useEffect(() => {
    if (!isAuthenticated || !firstTeam || defaultKey || lazyCreating) return;
    setLazyCreating(true);
    api
      .post<{ secret: string; created: boolean }>("/v1/auth/default-agent-key", {
        team_id: firstTeam.id,
      })
      .then(() => mutate())
      .catch(() => {})
      .finally(() => setLazyCreating(false));
  }, [isAuthenticated, firstTeam, defaultKey, lazyCreating, mutate]);
  const activeKey = defaultKey || PLACEHOLDER;
  const hasRealKey = activeKey !== PLACEHOLDER;

  const editor = EDITORS[selectedEditor];
  const configText = editor.scopes[0].config(activeKey, MCP_URL, SERVER_NAME);

  return (
    <div>
      {/* Editor pill selector with fade mask */}
      <div className="relative">
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-hide">
          {EDITORS.map((e, i) => (
            <button
              key={e.name}
              type="button"
              onClick={() => setSelectedEditor(i)}
              className={`rounded-full px-4 py-1.5 text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                selectedEditor === i
                  ? "text-white shadow-[0_0_16px_oklch(0.555_0.163_48.998_/_0.35)]"
                  : "bg-muted text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              style={selectedEditor === i ? { background: "oklch(0.555 0.163 48.998)" } : undefined}
            >
              {e.name}
            </button>
          ))}
        </div>
        {/* Right fade to hint at scrollability */}
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-3 w-12"
          style={{ background: "linear-gradient(to right, transparent, var(--background))" }}
        />
      </div>

      {/* Config display */}
      <div
        className="relative rounded-xl border border-border overflow-hidden"
        style={{ background: "oklch(0.13 0.015 55)" }}
      >
        {/* Top accent line */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, oklch(0.555 0.163 48.998 / 0.4), transparent)" }}
        />
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
            </div>
            <span className="text-xs font-medium text-white/50 ml-2">{editor.name}</span>
          </div>
          <TerminalCopyButton text={configText} />
        </div>
        <pre className="px-5 py-4 text-[13px] leading-relaxed font-mono overflow-x-auto">
          <code className="text-white/80">{hasRealKey ? (
            configText.split(activeKey).map((part, i, arr) => (
              <span key={i}>
                {part}
                {i < arr.length - 1 && <span className="text-green-400">{activeKey}</span>}
              </span>
            ))
          ) : configText}</code>
        </pre>
      </div>

      {/* Note — only show when no real key */}
      {!hasRealKey && (
        <p className="mt-2.5 text-[11px] text-muted-foreground/70 tracking-wide">
          Sign in above to get your key auto-filled
        </p>
      )}
    </div>
  );
}
