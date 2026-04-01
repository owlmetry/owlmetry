"use client";

import { useState, useEffect } from "react";
import { Check, Mail } from "lucide-react";
import { useUser } from "@/hooks/use-user";
import { api, ApiError } from "@/lib/api";
import { PLACEHOLDER } from "@/lib/mcp-editors";

export function LandingAuth() {
  const { user, teams, isLoading, mutate } = useUser();
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isAuthenticated = !!user;

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/v1/auth/send-code", { email });
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to send code");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/v1/auth/verify-code", { email, code });
      await mutate();
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div
        className="rounded-xl border border-border overflow-hidden animate-pulse"
        style={{ background: "oklch(0.13 0.015 55)" }}
      >
        <div className="px-5 py-6">
          <div className="h-4 w-48 rounded bg-white/[0.06]" />
          <div className="mt-4 h-10 rounded bg-white/[0.06]" />
        </div>
      </div>
    );
  }

  // Authenticated state — compact success banner
  if (isAuthenticated || step === "done") {
    return (
      <div
        className="relative rounded-xl border border-border overflow-hidden"
        style={{ background: "oklch(0.13 0.015 55)" }}
      >
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, oklch(0.4 0.17 155 / 0.5), transparent)" }}
        />
        <div className="px-5 py-4 flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full shrink-0"
            style={{ background: "oklch(0.3 0.08 155 / 0.3)" }}
          >
            <Check className="h-4 w-4 text-green-400" />
          </div>
          <p className="text-sm font-medium text-white/80">
            Signed in as <span className="text-white/60">{user?.email}</span>
          </p>
        </div>
      </div>
    );
  }

  // Unauthenticated — email or code form
  return (
    <div
      className="relative rounded-xl border border-border overflow-hidden"
      style={{ background: "oklch(0.13 0.015 55)" }}
    >
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, oklch(0.555 0.163 48.998 / 0.4), transparent)" }}
      />
      <div className="px-5 py-5">
        {step === "email" ? (
          <form onSubmit={handleSendCode}>
            <div className="flex items-center gap-2 mb-3">
              <Mail className="h-4 w-4 text-white/40" />
              <p className="text-sm text-white/60">
                Sign in to get your API key pre-filled below
              </p>
            </div>
            {error && (
              <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="flex-1 h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white/90 placeholder:text-white/25 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-colors"
              />
              <button
                type="submit"
                disabled={loading}
                className="h-10 rounded-lg px-5 text-sm font-medium text-white transition-all disabled:opacity-50 hover:brightness-110"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              >
                {loading ? "Sending..." : "Send code"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode}>
            <p className="text-sm text-white/60 mb-3">
              Enter the code sent to <span className="text-white/80">{email}</span>
            </p>
            {error && (
              <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                required
                autoFocus
                className="w-32 h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-center text-lg tracking-[0.3em] font-mono text-white/90 placeholder:text-white/20 focus:outline-none focus:border-white/20 focus:ring-1 focus:ring-white/10 transition-colors"
              />
              <button
                type="submit"
                disabled={loading || code.length !== 6}
                className="h-10 rounded-lg px-5 text-sm font-medium text-white transition-all disabled:opacity-50 hover:brightness-110"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              >
                {loading ? "Verifying..." : "Verify"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => { setStep("email"); setCode(""); setError(""); }}
              className="mt-2.5 text-xs text-white/30 hover:text-white/50 transition-colors"
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
