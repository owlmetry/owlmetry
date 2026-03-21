import { cookies } from "next/headers";
import Link from "next/link";
import Image from "next/image";
import {
  Bot,
  Terminal,
  Database,
  Smartphone,
  Shield,
  Search,
  ArrowRight,
  Check,
} from "lucide-react";
import { MarketingNav } from "@/components/marketing-nav";
import { MarketingFooter } from "@/components/marketing-footer";

const features = [
  {
    icon: Bot,
    title: "Agent-Native API",
    description: "Every operation available through agent API keys. Your coding agent can set up, monitor, and diagnose — no human in the loop.",
  },
  {
    icon: Terminal,
    title: "CLI for Agents & Humans",
    description: "JSON output for machine consumption, tables for humans. Same tool, both audiences.",
  },
  {
    icon: Database,
    title: "Single Postgres",
    description: "No Kafka, no ClickHouse, no Redis. One database with monthly partitioned events. That's the entire backend.",
  },
  {
    icon: Smartphone,
    title: "Multi-Platform SDKs",
    description: "Native SDKs for Swift and Node.js with automatic batching, gzip compression, and retry logic built in.",
  },
  {
    icon: Shield,
    title: "Self-Hosted by Design",
    description: "Your data never leaves your servers. GDPR and HIPAA compliance becomes a property of your infrastructure, not a vendor promise.",
  },
  {
    icon: Search,
    title: "Dashboard Optional",
    description: "The web UI is a visual layer, not the primary interface. Everything the dashboard can do, your agent can do through the API.",
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

            <h1 className="mt-10 text-4xl font-bold tracking-tight text-white md:text-5xl lg:text-[3.5rem] lg:leading-[1.1] landing-stagger-2">
              Agent-first observability.
              <br />
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(135deg, oklch(0.65 0.2 45) 0%, oklch(0.555 0.163 48.998) 50%, oklch(0.5 0.14 55) 100%)",
                }}
              >
                No humans required.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-base text-white/55 leading-relaxed md:text-lg landing-stagger-3">
              Self-hosted observability for the agentic era. Point your coding
              agent at OwlMetry and it handles everything — integration,
              monitoring, debugging, performance analysis. Your infrastructure.
              Your data.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row landing-stagger-4">
              <Link
                href={ctaHref}
                className="group inline-flex h-11 items-center justify-center rounded-lg px-8 text-sm font-medium text-white transition-all duration-200 hover:shadow-[0_0_24px_oklch(0.555_0.163_48.998_/_0.4)] hover:brightness-110"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              >
                {ctaLabel}
                <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <a
                href="#features"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-white/15 px-8 text-sm font-medium text-white/70 transition-all duration-200 hover:border-white/30 hover:bg-white/5 hover:text-white"
              >
                Learn More
              </a>
            </div>
          </div>
        </div>

      </section>

      {/* Features */}
      <section id="features" className="py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-4">
              Capabilities
            </p>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Built for agents, usable by humans
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Most observability tools are built for humans staring at dashboards.
              OwlMetry is built for agents making API calls.
            </p>
          </div>

          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group relative rounded-xl border bg-card p-6 transition-all duration-300 hover:border-primary/30 hover:shadow-xl hover:shadow-primary/[0.04] hover:-translate-y-0.5"
              >
                <div
                  className="absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, oklch(0.555 0.163 48.998 / 0.5), transparent)",
                  }}
                />
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-all duration-300 group-hover:bg-primary/15 group-hover:shadow-[0_0_16px_oklch(0.555_0.163_48.998_/_0.15)]">
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-24 md:py-32 bg-muted/30">
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary mb-4">
              How it works
            </p>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Your agent does the work
            </h2>
            <p className="mt-4 text-muted-foreground">
              Point your coding agent at OwlMetry. It takes it from there.
            </p>
          </div>

          <div className="mt-16 relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-7 left-[calc(16.67%+28px)] right-[calc(16.67%+28px)] h-px bg-border" />

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
                  <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                    {step.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Get Started */}
      <section id="get-started" className="relative py-24 md:py-32 overflow-hidden" style={{ background: "oklch(0.12 0.015 55)" }}>
        {/* Subtle grid texture */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(oklch(0.555 0.163 48.998) 1px, transparent 1px),
              linear-gradient(90deg, oklch(0.555 0.163 48.998) 1px, transparent 1px)`,
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] mb-4" style={{ color: "oklch(0.555 0.163 48.998)" }}>
              Get started
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-white/95 md:text-4xl">
              One install. One prompt. You&apos;re done.
            </h2>
            <p className="mt-4 text-white/50 max-w-xl mx-auto">
              Your agent reads the skill files and handles the rest &mdash; auth, project setup, and SDK integration.
            </p>
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-2">
            {/* Left — You */}
            <div className="rounded-xl border border-white/10 overflow-hidden bg-white/[0.02]">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                </div>
                <span className="text-xs font-medium text-white/50 ml-2">You &mdash; Terminal</span>
              </div>
              <div className="p-5">
                <pre className="text-[13px] leading-relaxed font-mono">
                  <code>
                    <span className="text-white/35"># Install the CLI</span>
                    {"\n"}
                    <span className="text-green-400">$</span>{" "}
                    <span className="text-white/80">npm install -g @owlmetry/cli</span>
                  </code>
                </pre>
                <div className="mt-6 mb-2 border-t border-white/[0.06] pt-5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-white/30 mb-3">Then tell your agent</p>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                    <p className="text-[13px] leading-relaxed text-white/70 font-mono">
                      Run <span className="text-orange-400">`owlmetry skills`</span>, install{"\n"}
                      those skill files, and set up{"\n"}
                      OwlMetry for this project.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right — Your Agent */}
            <div className="rounded-xl border border-white/10 overflow-hidden bg-white/[0.02]">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/[0.07] ring-1 ring-white/[0.05]" />
                </div>
                <span className="text-xs font-medium text-white/50 ml-2">Your Agent</span>
              </div>
              <pre className="p-5 text-[13px] leading-relaxed overflow-x-auto font-mono">
                <code>
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry skills</span>
                  {"\n"}
                  {"  "}
                  <span className="text-white/40">CLI</span>{"        "}
                  <span className="text-white/60">/.../owlmetry-cli/SKILL.md</span>
                  {"\n"}
                  {"  "}
                  <span className="text-white/40">Node SDK</span>{"   "}
                  <span className="text-white/60">/.../owlmetry-node/SKILL.md</span>
                  {"\n"}
                  {"  "}
                  <span className="text-white/40">Swift SDK</span>{"  "}
                  <span className="text-white/60">/.../owlmetry-swift/SKILL.md</span>
                  {"\n\n"}
                  <span className="text-white/35">Reading skill files...</span>
                  {"\n\n"}
                  <span className="text-blue-400">What&apos;s your email?</span>{"  "}
                  <span className="text-white/60">dev@example.com</span>
                  {"\n\n"}
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry auth send-code</span>{" "}
                  <span className="text-white/60">--email dev@example.com</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/60">Code sent!</span>
                  {"\n\n"}
                  <span className="text-blue-400">What&apos;s the 6-digit code?</span>{"  "}
                  <span className="text-white/60">482901</span>
                  {"\n\n"}
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry auth verify</span>{" "}
                  <span className="text-white/60">...</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/60">Authenticated!</span>
                  {"\n\n"}
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry projects create</span>{" "}
                  <span className="text-white/60">--name &quot;Acme&quot; ...</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/60">Project created</span>
                  {"\n\n"}
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry apps create</span>{" "}
                  <span className="text-white/60">--platform apple ...</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/60">App created</span>
                  {"\n\n"}
                  <span className="text-white/35">Adding OwlMetry SDK to your project...</span>
                  {"\n"}
                  <span className="text-green-400">✓</span>{" "}
                  <span className="text-white/60">Instrumentation complete</span>
                </code>
              </pre>
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
              Free. Forever. Self-hosted.
            </h2>
            <p className="mt-4 text-muted-foreground">
              No usage limits. No per-seat pricing. No vendor lock-in.
            </p>
          </div>

          <div className="mt-16 mx-auto max-w-md relative">
            {/* Glow behind card */}
            <div
              className="absolute -inset-4 rounded-3xl blur-2xl opacity-[0.08]"
              style={{ background: "oklch(0.555 0.163 48.998)" }}
            />
            <div className="relative rounded-2xl border-2 border-primary/20 bg-card p-8 text-center shadow-xl">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary tracking-wide">
                Open Source
              </div>
              <p className="mt-6 text-5xl font-bold tracking-tight">$0</p>
              <p className="mt-1 text-sm text-muted-foreground">forever</p>

              <ul className="mt-8 space-y-3 text-left">
                {[
                  "Unlimited events & apps",
                  "Agent API keys + CLI",
                  "Swift & Node.js SDKs",
                  "Single Postgres — no infra sprawl",
                  "Full REST API",
                  "Optional web dashboard",
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
