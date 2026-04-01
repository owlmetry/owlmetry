"use client";

import { useState } from "react";
import { EDITORS, PLACEHOLDER, MCP_URL, SERVER_NAME } from "@/lib/mcp-editors";
import { TerminalCopyButton } from "@/components/terminal-copy-button";

export function LandingMcpSetup() {
  const [selectedEditor, setSelectedEditor] = useState(0);
  const editor = EDITORS[selectedEditor];
  const configText = editor.scopes[0].config(PLACEHOLDER, MCP_URL, SERVER_NAME);

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
          <code className="text-white/80">{configText}</code>
        </pre>
      </div>

      {/* Note — inline with subtle styling */}
      <p className="mt-2.5 text-[11px] text-muted-foreground/70 tracking-wide">
        Replace <code className="rounded bg-muted px-1 py-0.5 text-[10px] font-semibold text-foreground/60 tracking-wider">YOUR_AGENT_KEY</code> with
        your key from the{" "}
        <a href="/login" className="text-primary/70 hover:text-primary transition-colors">
          dashboard
        </a>
      </p>
    </div>
  );
}
