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
    description: "The agent queries events, diagnoses issues, traces user sessions, and writes the fix. You review the PR.",
  },
];

export default function LandingPage() {
  return (
    <>
      <MarketingNav />
      <main>
      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{ background: "oklch(0.12 0.015 55)" }}
      >
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: `linear-gradient(oklch(0.555 0.163 48.998) 1px, transparent 1px),
              linear-gradient(90deg, oklch(0.555 0.163 48.998) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
        {/* Radial glow */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 30%, oklch(0.555 0.163 48.998 / 0.1) 0%, transparent 60%)",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6 py-24 md:py-32 lg:py-40">
          <div className="flex flex-col items-center text-center">
            <div className="landing-stagger-1">
              <Image
                src="/owl-logo.png"
                alt="OwlMetry"
                width={128}
                height={128}
                className="h-24 w-24 md:h-32 md:w-32 landing-float"
              />
            </div>

            <h1 className="mt-8 text-4xl font-bold tracking-tight text-white/95 md:text-5xl lg:text-6xl landing-stagger-2">
              Agent-first observability.
              <br />
              <span style={{ color: "oklch(0.555 0.163 48.998)" }}>
                No humans required.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg text-white/50 leading-relaxed landing-stagger-3">
              Self-hosted observability for the agentic era. Point your coding
              agent at OwlMetry and it handles everything — integration,
              monitoring, debugging, performance analysis. Your infrastructure.
              Your data.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row landing-stagger-4">
              <Link
                href="/register"
                className="inline-flex h-11 items-center justify-center rounded-lg px-8 text-sm font-medium text-white transition-colors"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-white/15 px-8 text-sm font-medium text-white/70 transition-colors hover:bg-white/5 hover:text-white/90"
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
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Built for agents, usable by humans
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Most observability tools are built for humans staring at dashboards.
              OwlMetry is built for agents making API calls.
            </p>
          </div>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border bg-card p-6 transition-all duration-200 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
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
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Your agent does the work
            </h2>
            <p className="mt-4 text-muted-foreground">
              Point your coding agent at OwlMetry. It takes it from there.
            </p>
          </div>

          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="relative text-center">
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold text-white"
                  style={{ background: "oklch(0.555 0.163 48.998)" }}
                >
                  {step.number}
                </div>
                <h3 className="mt-6 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code Preview — Data in, Insights out */}
      <section className="py-24 md:py-32" style={{ background: "oklch(0.12 0.015 55)" }}>
        <div className="mx-auto max-w-6xl px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white/95 md:text-4xl">
              Data in. Insights out.
            </h2>
            <p className="mt-4 text-white/50">
              Your app sends events. Your agent queries them.
            </p>
          </div>

          <div className="mt-16 grid gap-6 md:grid-cols-2">
            {/* SDK — Data in */}
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-white/10" />
                  <span className="h-3 w-3 rounded-full bg-white/10" />
                  <span className="h-3 w-3 rounded-full bg-white/10" />
                </div>
                <span className="text-xs text-white/40 ml-2">Your app &mdash; Node.js SDK</span>
              </div>
              <pre className="p-5 text-sm leading-relaxed overflow-x-auto">
                <code>
                  <span className="text-orange-400">import</span>{" "}
                  <span className="text-white/60">{"{"}</span>{" "}
                  <span className="text-white/80">Owl</span>{" "}
                  <span className="text-white/60">{"}"}</span>{" "}
                  <span className="text-orange-400">from</span>{" "}
                  <span className="text-green-400">&quot;@owlmetry/node&quot;</span>
                  {"\n\n"}
                  <span className="text-purple-400">Owl</span>
                  <span className="text-white/60">.</span>
                  <span className="text-blue-400">configure</span>
                  <span className="text-white/60">({"{"}</span>
                  {"\n"}
                  {"  "}
                  <span className="text-white/60">endpoint:</span>{" "}
                  <span className="text-green-400">&quot;https://your-server.com&quot;</span>
                  <span className="text-white/60">,</span>
                  {"\n"}
                  {"  "}
                  <span className="text-white/60">apiKey:</span>{" "}
                  <span className="text-green-400">&quot;owl_client_...&quot;</span>
                  {"\n"}
                  <span className="text-white/60">{"}"})</span>
                  {"\n\n"}
                  <span className="text-white/40">// Events flow in from your app</span>
                  {"\n"}
                  <span className="text-purple-400">Owl</span>
                  <span className="text-white/60">.</span>
                  <span className="text-blue-400">info</span>
                  <span className="text-white/60">(</span>
                  <span className="text-green-400">&quot;User logged in&quot;</span>
                  <span className="text-white/60">,</span>{" "}
                  <span className="text-white/60">{"{"}</span>{" "}
                  <span className="text-white/60">route:</span>{" "}
                  <span className="text-green-400">&quot;/auth&quot;</span>{" "}
                  <span className="text-white/60">{"}"})</span>
                  {"\n"}
                  <span className="text-purple-400">Owl</span>
                  <span className="text-white/60">.</span>
                  <span className="text-blue-400">error</span>
                  <span className="text-white/60">(</span>
                  <span className="text-green-400">&quot;Payment failed&quot;</span>
                  <span className="text-white/60">,</span>{" "}
                  <span className="text-white/60">{"{"}</span>{" "}
                  <span className="text-white/60">err</span>{" "}
                  <span className="text-white/60">{"}"})</span>
                  {"\n"}
                  <span className="text-purple-400">Owl</span>
                  <span className="text-white/60">.</span>
                  <span className="text-blue-400">warn</span>
                  <span className="text-white/60">(</span>
                  <span className="text-green-400">&quot;Rate limit hit&quot;</span>
                  <span className="text-white/60">,</span>{" "}
                  <span className="text-white/60">{"{"}</span>{" "}
                  <span className="text-white/60">ip</span>{" "}
                  <span className="text-white/60">{"}"})</span>
                </code>
              </pre>
            </div>

            {/* Agent — Insights out */}
            <div className="rounded-xl border border-white/10 overflow-hidden">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <div className="flex gap-1.5">
                  <span className="h-3 w-3 rounded-full bg-white/10" />
                  <span className="h-3 w-3 rounded-full bg-white/10" />
                  <span className="h-3 w-3 rounded-full bg-white/10" />
                </div>
                <span className="text-xs text-white/40 ml-2">Your agent &mdash; CLI</span>
              </div>
              <pre className="p-5 text-sm leading-relaxed overflow-x-auto">
                <code>
                  <span className="text-white/40"># Agent finds the errors</span>
                  {"\n"}
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry events</span>{" "}
                  <span className="text-white/60">--level error --since 1h</span>
                  {"\n\n"}
                  <span className="text-white/40"># Pulls context around the incident</span>
                  {"\n"}
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry investigate</span>{" "}
                  <span className="text-white/60">evt_3f8a --window 10</span>
                  {"\n\n"}
                  <span className="text-white/40"># Reads the data as JSON</span>
                  {"\n"}
                  <span className="text-green-400">$</span>{" "}
                  <span className="text-white/80">owlmetry events</span>{" "}
                  <span className="text-white/60">--format json \</span>
                  {"\n"}
                  {"  "}
                  <span className="text-white/60">--level error --since 1h</span>
                  {"\n\n"}
                  <span className="text-white/40"># Understands the problem. Writes the fix.</span>
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
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Free. Forever. Self-hosted.
            </h2>
            <p className="mt-4 text-muted-foreground">
              No usage limits. No per-seat pricing. No vendor lock-in.
            </p>
          </div>

          <div className="mt-16 mx-auto max-w-md">
            <div className="rounded-2xl border-2 border-primary/30 bg-card p-8 text-center shadow-lg shadow-primary/5">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Open Source
              </div>
              <p className="mt-6 text-5xl font-bold tracking-tight">$0</p>
              <p className="mt-2 text-muted-foreground">forever</p>

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
                href="/register"
                className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-lg text-sm font-medium text-white transition-colors"
                style={{ background: "oklch(0.555 0.163 48.998)" }}
              >
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="py-24 md:py-32 bg-primary/5">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Let your agent handle observability.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-lg mx-auto">
            Deploy on your infrastructure. Your agent sets up the integration,
            monitors production, and acts on what it finds. You review the PR.
          </p>
          <div className="mt-10">
            <Link
              href="/register"
              className="inline-flex h-12 items-center justify-center rounded-lg px-10 text-sm font-medium text-white transition-colors"
              style={{ background: "oklch(0.555 0.163 48.998)" }}
            >
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
      <MarketingFooter />
    </>
  );
}
