"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { EDITORS, PLACEHOLDER, MCP_URL, SERVER_NAME, maskKey } from "@/lib/mcp-editors";
import { useUser } from "@/hooks/use-user";
import { TerminalCopyButton } from "@/components/terminal-copy-button";

export function LandingMcpSetup() {
  const { teams } = useUser();
  const [selectedEditor, setSelectedEditor] = useState(0);
  const [keyVisible, setKeyVisible] = useState(false);

  const defaultKey = teams?.[0]?.default_agent_key;
  const activeKey = defaultKey || PLACEHOLDER;
  const hasRealKey = activeKey !== PLACEHOLDER;
  const displayKey = keyVisible ? activeKey : maskKey(activeKey);

  const editor = EDITORS[selectedEditor];
  const configText = editor.scopes[0].config(activeKey, MCP_URL, SERVER_NAME);
  const configDisplay = editor.scopes[0].config(displayKey, MCP_URL, SERVER_NAME);

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
          <div className="flex items-center gap-1">
            {hasRealKey && (
              <button
                type="button"
                onClick={() => setKeyVisible(!keyVisible)}
                className="p-1.5 rounded-md text-white/30 hover:text-white/60 transition-colors"
                title={keyVisible ? "Hide key" : "Show key"}
              >
                {keyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            )}
            <TerminalCopyButton text={configText} />
          </div>
        </div>
        <pre className="px-5 py-4 text-[13px] leading-relaxed font-mono overflow-x-auto">
          <code className="text-white/80">{configDisplay}</code>
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
