# Contributing to DurableWS

Thanks for your interest in contributing! DurableWS is being built in the open, and contributions — issues, docs, fixes, features — are welcome.

> **Where things stand:** v2 has shipped (`durablews@2.0.0`). [ROADMAP.md](ROADMAP.md) is the live plan; [RFC 0001](rfcs/0001-v2-architecture.md) records the architecture and why it is the way it is. Before starting non-trivial work, see [Proposing changes](#proposing-changes).

## Prerequisites

- **Node.js ≥ 22** (DurableWS targets the standard global `WebSocket`, which Node ships unflagged from v22)
- **pnpm** (the repo is a pnpm monorepo; the version is pinned via `packageManager`)

## Getting started

```bash
git clone https://github.com/imnsco/DurableWS.git
cd durablews
pnpm install        # installs deps and sets up the git hooks
```

The published library is in [`packages/durablews`](packages/durablews).

## Development workflow

```bash
pnpm -F durablews test       # vitest (watch)
pnpm -F durablews test:run   # vitest (once)
pnpm -F durablews build      # tsup build
pnpm typecheck               # tsc --noEmit
pnpm lint                    # Biome check
pnpm format                  # Biome format (write)
pnpm verify                      # run the full CI gate locally
```

- **Formatting & linting** is handled by [Biome](https://biomejs.dev). A [lefthook](https://lefthook.dev) pre-commit hook runs Biome on staged files automatically, so commits stay formatted.
- **Tests** use [Vitest](https://vitest.dev). New behavior needs tests; assert on observable state/outcomes, not merely that an event fired.
- **CI** runs Biome, typecheck, build, tests, and publish validation (publint + are-the-types-wrong) on Node 22 and 24. Run `pnpm verify` before pushing.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `refactor:`, `test:`). Keep commits focused.

## Changesets

We use [changesets](https://github.com/changesets/changesets) for versioning and the changelog. If your change affects the published package, add a changeset:

```bash
pnpm changeset
```

Pick the appropriate semver bump and write a short, user-facing summary. Tooling-only or docs-only changes that don't affect consumers don't need one.

## Proposing changes

Match the weight of the process to the weight of the change:

- **Bug fixes and small improvements** — open a PR directly.
- **Features** — open an issue first, so the approach is agreed before code is written. Scheduled work lives in [ROADMAP.md](ROADMAP.md).
- **Architecture-level changes** — public API shape, packaging/exports, protocol semantics; anything expensive to reverse — start an RFC. The process is one page: [rfcs/README.md](rfcs/README.md).

## Pull requests

1. Branch from `main`.
2. Make your change with tests and (if user-facing) a changeset.
3. Ensure `pnpm verify` passes.
4. Open a PR against `main` and fill out the template.

## Plugins & add-ons

DurableWS keeps a small core and ships optional capabilities as **subpath exports** — named by what they are:

- **middleware** — cross-cutting behavior over the message pipeline (auth, logging, retry hooks)
- **codecs** — the wire format (`encode`/`decode`), e.g. JSON (default), msgpack
- **plugins** — add-ons that extend the client's public API (e.g. channels/presence)

### Naming convention for third-party packages

To keep the ecosystem consistent and discoverable, community add-ons should be named:

```
durablews-plugin-<name>
```

For example, `durablews-plugin-msgpack` or `durablews-plugin-presence`. Officially maintained add-ons live inside this repo and are published as subpath exports of the single `durablews` package (e.g. `durablews/socketio`), not as separate packages.

## Code of Conduct

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).
