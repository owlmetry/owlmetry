# @owlmetry/cli

CLI for [Owlmetry](https://owlmetry.com) — self-hosted metrics tracking for mobile and backend apps.

Manage projects, apps, metrics, funnels, and events from the terminal. Ships with AI skill files to teach your coding agent how to use Owlmetry.

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

Owlmetry's three Claude Code skills (`owlmetry-cli`, `owlmetry-node`, `owlmetry-swift`) live in the [owlmetry-skills](https://github.com/owlmetry/owlmetry-skills) plugin marketplace. Run:

```bash
owlmetry skills
```

for the install snippet (`/plugin marketplace add` + `/plugin install`).

## Links

- [Website](https://owlmetry.com)
- [GitHub](https://github.com/owlmetry/owlmetry)
