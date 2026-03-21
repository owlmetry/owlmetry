# @owlmetry/cli

CLI for [OwlMetry](https://owlmetry.com) — self-hosted metrics tracking for mobile and backend apps.

Manage projects, apps, metrics, funnels, and events from the terminal. Ships with AI skill files to teach your coding agent how to use OwlMetry.

## Install

```bash
npm install -g @owlmetry/cli
```

## Quick Start

```bash
# Sign up or log in
owlmetry auth send-code --email you@example.com
owlmetry auth verify --email you@example.com --code 123456

# Save your credentials
owlmetry setup --endpoint https://api.owlmetry.com --api-key owl_agent_...

# Explore
owlmetry projects
owlmetry apps
owlmetry events --last 1h
owlmetry metrics
owlmetry funnels
```

## AI Skills

This package bundles skill files that teach AI agents (Claude Code, Codex, etc.) how to use OwlMetry — including the CLI, Node SDK, and Swift SDK.

```bash
owlmetry skills
```

This prints the absolute paths to each skill file. Point your agent to these files to give it full OwlMetry knowledge.

## Links

- [Website](https://owlmetry.com)
- [GitHub](https://github.com/Jasonvdb/owlmetry)
