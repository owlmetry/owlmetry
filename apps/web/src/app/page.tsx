import { cookies } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import {
  Bot,
  Activity,
  Timer,
  Filter,
  Smartphone,
  Shield,
  ArrowRight,
  Check,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";
import { TerminalCopyButton } from "@/components/terminal-copy-button";

const features = [
  {
    icon: Bot,
    title: "Agent-Native API",
    description: "Your coding agent sets up tracking, queries data, and diagnoses issues — no dashboard needed, though there's one if you want it.",
  },
  {
    icon: Activity,
    title: "Events",
    description: "Know exactly what happened and when. Structured events with log levels, session tracking, and screen context give you a complete picture of every user journey.",
  },
  {
    icon: Timer,
    title: "Metrics",
    description: "Find your slowest screens and flakiest network calls. Time any operation end-to-end and catch performance regressions before users notice.",
  },
  {
    icon: Filter,
    title: "Funnels",
    description: "See where users drop off. Define multi-step funnels, compare conversion across app versions, and measure the impact of A/B experiments.",
  },
  {
    icon: Smartphone,
    title: "Multi-Platform SDKs",
    description: "Drop in a Swift or Node.js SDK and start collecting data in minutes. Batching, compression, and retry happen automatically.",
  },
  {
    icon: Shield,
    title: "Self-Hosted by Design",
    description: "Your data stays on your servers. Privacy compliance becomes a property of your infrastructure, not a vendor promise.",
  },
];

const steps = [
  {
    number: "01",
    title: "Deploy",
    description: "One Postgres database, one API server. Point your agent at the setup instructions and it handles the rest.",
  },
  {
    number: "02",
    title: "Integrate",
    description: "Your agent adds the SDK, configures the API key, and starts tracking events — without you opening an editor.",
  },
  {
    number: "03",
    title: "Monitor & Fix",
    description: "The agent queries events, diagnoses issues, traces user sessions, and writes the fix. You review the changes.",
  },
];

export default async function LandingPage() {
  const cookieStore = await cookies();
  const isAuthenticated = !!cookieStore.get("token")?.value;
  const ctaLabel = isAuthenticated ? "Dashboard" : "Get Started";
  const ctaHref = isAuthenticated ? "/dashboard" : "/login";

  return (
    <>
      <MarketingNav isAuthenticated={isAuthenticated} />
      <main>
      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{ background: "oklch(0.12 0.015 55)" }}
      >
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: `linear-gradient(oklch(0.555 0.163 48.998) 1px, transparent 1px),
              linear-gradient(90deg, oklch(0.555 0.163 48.998) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
        {/* Radial glow — larger, warmer */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 35%, oklch(0.555 0.163 48.998 / 0.14) 0%, transparent 55%)",
          }}
        />
        {/* Secondary glow — bottom edge warmth */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 100%, oklch(0.555 0.163 48.998 / 0.06) 0%, transparent 40%)",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6 pt-28 pb-32 md:pt-36 md:pb-40 lg:pt-44 lg:pb-48">
          <div className="flex flex-col items-center text-center">
            {/* Owl with ambient glow */}
            <div className="landing-stagger-1 relative">
              <div
                className="absolute -inset-8 rounded-full blur-2xl opacity-30"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              />
              <Image
                src="/owl-logo.png"
                alt="OwlMetry"
                width={128}
                height={128}
                className="relative h-24 w-24 md:h-28 md:w-28 landing-float drop-shadow-[0_0_30px_oklch(0.555_0.163_48.998_/_0.3)]"
              />
            </div>

            <div className="mt-8 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1 landing-stagger-2">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400/80 animate-pulse" />
              <span className="text-xs font-medium text-white/40 tracking-wide">Alpha</span>
            </div>

            <h1 className="mt-5 text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-[3.5rem] lg:leading-[1.1] landing-stagger-2">
              Agent-first observability.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, oklch(0.65 0.2 45) 0%, oklch(0.555 0.163 48.998) 50%, oklch(0.5 0.14 55) 100%)",
                }}
              >
                For every app you ship.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base text-white/55 leading-relaxed md:text-lg landing-stagger-3">
              Structured events, performance metrics, and conversion funnels
              — purpose-built to be driven by Claude Code, Codex, OpenClaw,
              Cursor, or whichever coding agent you use.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row landing-stagger-4">
              <a
                href="#get-started"
                className="group inline-flex h-11 items-center justify-center rounded-lg px-8 text-sm font-medium text-white transition-all duration-200 hover:shadow-[0_0_24px_oklch(0.555_0.163_48.998_/_0.4)] hover:brightness-110"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
              <a
                href="https://github.com/Jasonvdb/owlmetry"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-8 text-sm font-medium text-white/70 transition-all duration-200 hover:border-white/30 hover:bg-white/5 hover:text-white"
              >
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" /></svg>
                Self-Host
              </a>
            </div>
          </div>
        </div>

      </section>

      {/* Get Started */}
      <section id="get-started" className="py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-4">
              Get started
            </p>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              One install. One prompt. You&apos;re done.
            </h2>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              Your agent reads the skill files and handles the rest &mdash; auth, project setup, and SDK integration.
            </p>
          </div>

          <div className="mt-16 mx-auto max-w-3xl space-y-5">
            {/* Step 1 — Install */}
            <div className="rounded-xl border overflow-hidden" style={{ background: "oklch(0.13 0.015 55)" }}>
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                  </div>
                  <span className="text-xs font-medium text-white/50 ml-2">Terminal</span>
                </div>
                <TerminalCopyButton text="npm install -g @owlmetry/cli" />
              </div>
              <pre className="px-5 py-4 text-[13px] leading-relaxed font-mono">
                <code>
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">npm install -g @owlmetry/cli</span>
                </code>
              </pre>
            </div>

            {/* Step 2 — Agent conversation */}
            <div className="rounded-xl border overflow-hidden" style={{ background: "oklch(0.13 0.015 55)" }}>
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                  </div>
                  <span className="text-xs font-medium text-white/50 ml-2">Your Agent</span>
                </div>
                <TerminalCopyButton text="Run 'owlmetry skills', install those skill files, then use the CLI skill to set up this project and the relevant SDK skill to instrument the app's code." />
              </div>
              <pre className="px-5 py-4 text-[13px] leading-relaxed font-mono whitespace-pre-wrap break-words">
                <code>
                  <span className="text-white/40">&gt;</span>{" "}
                  <span className="text-white/70">Run </span>
                  <span className="text-orange-400">owlmetry skills</span>
                  <span className="text-white/70">, install those skill files, then use the CLI skill to set up this project and the relevant SDK skill to instrument the app&apos;s code.</span>
                  {"\n\n"}
                  <span className="text-white/30">Reading skill files...</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/55">Authenticated!</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/55">Project created</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/55">App created</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/55">SDK installed</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/55">Instrumentation added</span>
                  {"\n\n"}
                  <span className="text-white/55">Done. OwlMetry is ready.</span>
                </code>
              </pre>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative py-24 md:py-32" style={{ background: "oklch(0.12 0.015 55)" }}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] mb-4" style={{ color: "oklch(0.555 0.163 48.998)" }}>
              Capabilities
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-white/95 md:text-4xl">
              Built for agents, usable by humans
            </h2>
            <p className="mt-4 text-white/50 max-w-2xl mx-auto">
              Most observability tools are built for humans staring at dashboards.
              OwlMetry is built for agents making API calls.
            </p>
          </div>

          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group relative rounded-xl border border-white/10 bg-white/[0.03] p-6 transition-all duration-300 hover:border-primary/30 hover:bg-white/[0.05] hover:-translate-y-0.5"
              >
                <div
                  className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, oklch(0.555 0.163 48.998 / 0.5), transparent)",
                  }}
                />
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.06] transition-all duration-300 group-hover:bg-white/[0.1]" style={{ color: "oklch(0.555 0.163 48.998)" }}>
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-white/90">{feature.title}</h3>
                <p className="mt-2 text-sm text-white/45 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section className="py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-4">
              Use cases
            </p>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Ask your agent. Get answers.
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Your agent uses the OwlMetry CLI to query events, trace sessions, analyze funnels, and monitor performance &mdash; all from natural language.
            </p>
          </div>

          <div className="mt-16 grid gap-5 md:grid-cols-2">
            {/* Card 1 — Debug a user report */}
            <div className="rounded-xl border overflow-hidden" style={{ background: "oklch(0.13 0.015 55)" }}>
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
                <p className="text-[13px] text-white/70">
                  <span className="text-white/30 mr-1.5">&gt;</span>
                  User 42 reported sync issues. What happened?
                </p>
              </div>
              <div className="px-5 py-4 text-[12.5px] leading-relaxed space-y-1.5">
                <p className="text-white/35">Querying errors for user 42...</p>
                <p className="text-white/35">Investigating surrounding events...</p>
                <p className="text-white/35">Tracing session timeline...</p>
                <div className="pt-2.5 mt-1.5 border-t border-white/[0.04]">
                  <p className="text-white/55">
                    Found 5 sync errors in session. Background refresh failing with 409 conflict &mdash; stale local state after app update. Surrounding events show repeated retry loop.
                  </p>
                </div>
              </div>
            </div>

            {/* Card 2 — Morning standup */}
            <div className="rounded-xl border overflow-hidden" style={{ background: "oklch(0.13 0.015 55)" }}>
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
                <p className="text-[13px] text-white/70">
                  <span className="text-white/30 mr-1.5">&gt;</span>
                  What app issues did we have overnight?
                </p>
              </div>
              <div className="px-5 py-4 text-[12.5px] leading-relaxed space-y-1.5">
                <p className="text-white/35">Pulling errors and warnings from the last 12 hours...</p>
                <p className="text-white/35">Grouping by message pattern...</p>
                <div className="pt-2.5 mt-1.5 border-t border-white/[0.04]">
                  <p className="text-white/55">
                    17 errors overnight. 12 are &quot;Payment gateway timeout&quot; starting at 3:14 AM &mdash; Stripe had a 47-minute outage. 5 unrelated auth errors from a single device.
                  </p>
                </div>
              </div>
            </div>

            {/* Card 3 — Funnel optimization */}
            <div className="rounded-xl border overflow-hidden" style={{ background: "oklch(0.13 0.015 55)" }}>
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
                <p className="text-[13px] text-white/70">
                  <span className="text-white/30 mr-1.5">&gt;</span>
                  Why is our onboarding conversion dropping?
                </p>
              </div>
              <div className="px-5 py-4 text-[12.5px] leading-relaxed space-y-1.5">
                <p className="text-white/35">Querying onboarding funnel for the last 7 days...</p>
                <p className="text-white/35">Comparing step drop-offs by app version...</p>
                <div className="pt-2.5 mt-1.5 border-t border-white/[0.04]">
                  <p className="text-white/55">
                    Drop-off between &quot;Create Account&quot; and &quot;Verify Email&quot; jumped from 12% to 34%. Only affects v2.4.1 &mdash; email verification deeplink is broken on iOS 18.
                  </p>
                </div>
              </div>
            </div>

            {/* Card 4 — Performance monitoring */}
            <div className="rounded-xl border overflow-hidden" style={{ background: "oklch(0.13 0.015 55)" }}>
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
                <p className="text-[13px] text-white/70">
                  <span className="text-white/30 mr-1.5">&gt;</span>
                  Is our photo upload getting slower?
                </p>
              </div>
              <div className="px-5 py-4 text-[12.5px] leading-relaxed space-y-1.5">
                <p className="text-white/35">Querying photo-upload metric for the last 7 days...</p>
                <p className="text-white/35">Comparing against the previous week...</p>
                <div className="pt-2.5 mt-1.5 border-t border-white/[0.04]">
                  <p className="text-white/55">
                    p50 steady at 1.2s but p95 climbed from 3.8s to 6.1s this week. Failure rate up 2%. Large files (&gt;5MB) are timing out on cellular connections.
                  </p>
                </div>
              </div>
            </div>

            {/* Card 5 — A/B experiment */}
            <div className="rounded-xl border overflow-hidden md:col-span-2" style={{ background: "oklch(0.13 0.015 55)" }}>
              <div className="px-5 pt-4 pb-3 border-b border-white/[0.06]">
                <p className="text-[13px] text-white/70">
                  <span className="text-white/30 mr-1.5">&gt;</span>
                  How is the checkout redesign experiment performing?
                </p>
              </div>
              <div className="px-5 py-4 text-[12.5px] leading-relaxed space-y-1.5">
                <p className="text-white/35">Querying checkout funnel segmented by experiment variant...</p>
                <p className="text-white/35">Comparing checkout completion time across variants...</p>
                <div className="pt-2.5 mt-1.5 border-t border-white/[0.04]">
                  <p className="text-white/55">
                    Variant B converts 23% better than control (68% vs 55%) and checkout time dropped from 4.2s to 2.8s. Variant A shows no significant difference. Recommend shipping Variant B.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="relative py-24 md:py-32" style={{ background: "oklch(0.12 0.015 55)" }}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] mb-4" style={{ color: "oklch(0.555 0.163 48.998)" }}>
              How it works
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-white/95 md:text-4xl">
              Your agent does the work
            </h2>
            <p className="mt-4 text-white/50">
              Point your coding agent at OwlMetry. It takes it from there.
            </p>
          </div>

          <div className="mt-16 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-7 left-[calc(16.67%+28px)] right-[calc(16.67%+28px)] h-px bg-white/10" />

            <div className="grid gap-12 md:grid-cols-3 md:gap-8">
              {steps.map((step) => (
                <div key={step.number} className="relative text-center">
                  <div
                    className="relative z-10 mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white shadow-lg"
                    style={{
                      background: "oklch(0.555 0.163 48.998)",
                      boxShadow: "0 0 24px oklch(0.555 0.163 48.998 / 0.3)",
                    }}
                  >
                    {step.number}
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-white/90">{step.title}</h3>
                  <p className="mt-2 text-sm text-white/45 leading-relaxed max-w-xs mx-auto">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-4">
              Pricing
            </p>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Simple pricing. No surprises.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Start free. Self-host for unlimited everything.
            </p>
          </div>

          <div className="mt-16 mx-auto max-w-5xl grid gap-5 md:grid-cols-3 items-stretch">
            {/* Free tier */}
            <div className="relative flex flex-col rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="inline-flex items-center gap-1.5 self-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground tracking-wide">
                Free
              </div>
              <p className="mt-6 text-5xl font-bold tracking-tight">$0</p>
              <p className="mt-1 text-sm text-muted-foreground">forever</p>

              <ul className="mt-8 space-y-3 text-left flex-1">
                {[
                  "1 app",
                  "10,000 events per month",
                  "Events, metrics & funnels",
                  "Agent API keys + CLI",
                  "Web dashboard",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>

              <Link
                href={ctaHref}
                className="group mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-medium text-muted-foreground transition-all duration-200 hover:border-foreground/30 hover:bg-muted hover:text-foreground"
              >
                {ctaLabel}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>

            {/* Pro tier */}
            <div className="relative flex flex-col rounded-2xl border-2 border-primary/30 bg-card p-8 text-center shadow-lg md:-my-4 md:py-10">
              {/* Glow behind card */}
              <div
                className="absolute -inset-4 rounded-3xl blur-2xl opacity-[0.1] -z-10"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              />
              <div className="inline-flex items-center gap-1.5 self-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary tracking-wide">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400/80 animate-pulse" />
                Free during alpha
              </div>
              <div className="mt-6 flex items-baseline justify-center gap-2">
                <span className="line-through text-muted-foreground/40 text-2xl font-semibold">$19/mo</span>
                <span className="text-5xl font-bold tracking-tight">$0</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">per month</p>

              <ul className="mt-8 space-y-3 text-left flex-1">
                {[
                  "Unlimited apps",
                  "Unlimited events",
                  "Events, metrics & funnels",
                  "Agent API keys + CLI",
                  "Web dashboard",
                  "Priority support",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>

              <Link
                href={ctaHref}
                className="group mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium text-white transition-all duration-200 hover:shadow-[0_0_24px_oklch(0.555_0.163_48.998_/_0.4)] hover:brightness-110"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              >
                {ctaLabel}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>

            {/* Self-hosted tier */}
            <div className="relative flex flex-col rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
              <div className="inline-flex items-center gap-1.5 self-center rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground tracking-wide">
                Self-Hosted
              </div>
              <p className="mt-6 text-5xl font-bold tracking-tight">$0</p>
              <p className="mt-1 text-sm text-muted-foreground">forever</p>

              <ul className="mt-8 space-y-3 text-left flex-1">
                {[
                  "Unlimited everything",
                  "Your infrastructure, your data",
                  "Single Postgres — no infra sprawl",
                  "Full REST API",
                  "Open source",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-3 text-sm">
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>

              <a
                href="https://github.com/Jasonvdb/owlmetry"
                target="_blank"
                rel="noopener noreferrer"
                className="group mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg border border-border text-sm font-medium text-muted-foreground transition-all duration-200 hover:border-foreground/30 hover:bg-muted hover:text-foreground"
              >
                View on GitHub
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative py-24 md:py-32 overflow-hidden bg-primary/[0.04]">
        {/* Decorative radial */}
        <div
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at 50% 50%, oklch(0.555 0.163 48.998 / 0.06) 0%, transparent 60%)",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Let your agent handle observability.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-lg mx-auto">
            Deploy on your infrastructure. Your agent sets up the integration,
            monitors production, and acts on what it finds.
          </p>
          <div className="mt-10">
            <Link
              href={ctaHref}
              className="group inline-flex h-12 items-center justify-center rounded-lg px-10 text-sm font-medium text-white transition-all duration-200 hover:shadow-[0_0_24px_oklch(0.555_0.163_48.998_/_0.4)] hover:brightness-110"
              style={{ background: "oklch(0.555 0.163 48.998)" }}
            >
              {ctaLabel}
              <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>
    </main>
      <MarketingFooter />
    </>
  );
}
