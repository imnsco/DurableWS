# DurableWS

[![npm](https://img.shields.io/npm/v/durablews)](https://www.npmjs.com/package/durablews)
[![CI](https://github.com/imnsco/DurableWS/actions/workflows/ci.yml/badge.svg)](https://github.com/imnsco/DurableWS/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/badge/core-%E2%89%A4%203%20KB%20brotli%20(CI--enforced)-blue)](packages/durablews/package.json)
[![license](https://img.shields.io/badge/license-MPL--2.0-green)](LICENSE)

> The WebSocket client that survives the real world — automatic reconnection, bounded queueing, and typed messages. Zero dependencies, built on the standard `WebSocket`, the same in every modern runtime (browser, Node ≥22, Deno, Bun, edge).

> **v2.0 is out** — `npm install durablews`. See **[durablews.imns.co](https://durablews.imns.co)** for the docs, and [RFC 0001](rfcs/0001-v2-architecture.md) for the architecture and a live status tracker.

The published library lives in **[`packages/durablews`](packages/durablews)** — see its [README](packages/durablews/README.md) for usage, the feature status, and requirements.

## Examples

Runnable, in [`examples/`](examples/):

- **[resilience-playground](examples/resilience-playground/)** — sabotage the server from the UI and watch the state machine, retry counter, and queue survive you. The flagship demo.
- **[chat](examples/chat/)** — presence + typing indicators, implemented twice (Vue composable, React hook) against one server and one zod schema.
- **[collab-notepad](examples/collab-notepad/)** — a raw-`WebSocket` collaborative editor made durable by swapping one import (`durablews/compat`).

## Why

socket.io and friends are heavy and predate Web Standards. DurableWS bets on the standard global `WebSocket` (now in every modern runtime), ships zero runtime dependencies, and makes durability — reconnection, queueing, idle detection — the default rather than something you bolt on. Extensibility comes from a middleware + codec pipeline, so custom wire formats, auth, and even a socket.io-compatibility layer are opt-in add-ons rather than core weight.

## Repository layout

This is a pnpm monorepo.

```
packages/durablews   the published library
docs/                the documentation site (Astro + Starlight → durablews.imns.co)
rfcs/                design RFCs (source of truth + live status)
```

## Development

Requires **Node ≥ 22** and **pnpm**.

```bash
pnpm install              # install workspace deps + git hooks

pnpm -F durablews test    # run the test suite (watch)
pnpm -F durablews test:run
pnpm -F durablews build   # tsup build (ESM + CJS + types)
pnpm typecheck            # tsc --noEmit
pnpm lint                 # Biome
pnpm format               # Biome (write)
pnpm verify               # everything CI runs, locally
```

Commits are formatted automatically by a [lefthook](https://lefthook.dev) pre-commit hook (Biome). Versioning and releases use [changesets](https://github.com/changesets/changesets).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — including the naming convention for third-party plugins. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities responsibly — see [SECURITY.md](SECURITY.md).

## License

[MPL-2.0](LICENSE) © Nate Smith
