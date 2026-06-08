# DurableWS

> A resilient, modern, zero-dependency WebSocket **client** for TypeScript — "the Hono of WebSockets." Built on the standard `WebSocket`, durable by default, and the same in every modern runtime (browser, Node ≥22, Deno, Bun, edge).

> ⚠️ **v2 is under active development.** See [RFC 0001](docs/rfc/0001-v2-architecture.md) for the architecture and a live status tracker. The current npm release (`1.x`) predates this redesign.

The published library lives in **[`packages/durablews`](packages/durablews)** — see its [README](packages/durablews/README.md) for usage, the feature status, and requirements.

## Why

socket.io and friends are heavy and predate Web Standards. DurableWS bets on the standard global `WebSocket` (now in every modern runtime), ships zero runtime dependencies, and makes durability — reconnection, queueing, idle detection — the default rather than something you bolt on. Extensibility comes from a middleware + codec pipeline, so custom wire formats, auth, and even a socket.io-compatibility layer are opt-in add-ons rather than core weight.

## Repository layout

This is a pnpm monorepo.

```
packages/durablews   the published library
docs/                documentation
  rfc/               design RFCs (source of truth + live status)
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
pnpm ci                   # everything CI runs, locally
```

Commits are formatted automatically by a [lefthook](https://lefthook.dev) pre-commit hook (Biome). Versioning and releases use [changesets](https://github.com/changesets/changesets).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — including the naming convention for third-party plugins. By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Please report vulnerabilities responsibly — see [SECURITY.md](SECURITY.md).

## License

[MPL-2.0](LICENSE) © Nate Smith
