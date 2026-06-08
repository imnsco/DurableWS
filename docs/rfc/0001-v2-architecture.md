# RFC 0001 — DurableWS v2 Architecture

- **Status:** Draft
- **Author:** Nate Smith
- **Created:** 2026-06-08
- **Supersedes:** the v1.x design (published as `durablews@1.0.1`)

---

## 1. Summary

DurableWS v2 is a ground-up redesign that takes the project from a toy side
project to a production- and OSS-ready library. The north star is **"the Hono
of WebSockets"**: a modern, ergonomic, Web-Standards-based, zero-dependency,
multi-runtime WebSocket library that is **durable by default**. It is positioned
as a modern alternative to socket.io, but **client-only** for v2.

The current v1 code advertises features it does not implement (automatic
reconnection, idle detection, message queueing, auth). v2 makes those real,
fixes latent correctness bugs, and establishes the architecture, testing, docs,
and release pipeline a serious OSS project needs.

## 2. Motivation

The v1 README and npm keywords promise durability the code does not deliver:

- **Automatic reconnection / exponential backoff** — not implemented. Nothing
  ever transitions to `RECONNECTING`.
- **Idle detection** — not implemented.
- **Message queueing** — not implemented; `send()` drops messages when closed.
- **Authentication** — not implemented.

There is also a latent correctness bug: the close handler is registered under
the event name `"closed"` while the client dispatches `"close"`, so the
connection state never transitions on disconnect. The test suite is green
because tests assert that *events fire*, not that *state is correct*.

The v1 architecture is a Redux-style store (`dispatch` → action handlers →
reduce into state). This is a poor fit for a streaming I/O + lifecycle problem:
the default message handler accumulates every message into `state.messages`
forever (an unbounded memory leak), and it forces four concepts (`dispatch`,
action, reducer, event) onto "a message arrived."

v1 has no users, so v2 is free to break the API.

## 3. Goals / Non-Goals

### Goals

- Durable by default: reconnection w/ exponential backoff, message queueing, and
  idle detection work out of the box with zero configuration.
- Zero runtime dependencies in core.
- Multi-runtime via the standard global `WebSocket`: browser, modern Node,
  Deno, Bun, edge. **Proven by cross-runtime e2e tests, not merely claimed.**
- Tiny, intuitive primary API. A new user receives messages and stays connected
  without learning any internal machinery.
- A clean, powerful extension story (middleware + codecs + plugins).
- First-class test pyramid, CI, docs site, and release pipeline.

### Non-Goals (for v2)

- **No server.** A server may come later as a separate package; explicitly out
  of scope for v2.
- **No general-purpose application-state manager.** Core owns only connection
  state. App state is the app's job; we win by making delivery into the user's
  own state tool effortless. Core stays zero-dep — we neither ship nor depend on
  a state library.
- **No `ws` dependency / injection.** Target modern runtimes that expose a
  standard global `WebSocket`.
- **socket.io protocol compatibility is a v2.x growth item, not a v2.0 anchor.**
  Core only owes it a clean codec + middleware seam so the plugin is possible.

## 4. Architecture

### 4.1 Overview

```
                  ┌─────────────────────────────────────────┐
   ws.onmessage → │ codec.decode → inbound middleware → emit │ → user handlers (.on)
                  └─────────────────────────────────────────┘
   client.send  → │ outbound middleware → codec.encode → ws.send (or queue)     │

   connection lifecycle  ──►  typed Finite State Machine (the only core state)
```

Four distinct seams, deliberately kept separate:

1. **Connection FSM** — owns lifecycle state and transitions.
2. **Codec** — the wire format (`encode`/`decode`).
3. **Middleware** — cross-cutting behavior over the message pipeline.
4. **Events** — how the user receives messages and lifecycle notifications.

### 4.2 Connection state: a typed finite state machine

The connection lifecycle is a finite state machine, not a generic reducer:

```
IDLE ──connect──► CONNECTING ──open──► CONNECTED
  ▲                   │                   │
  │                   │ error/close       │ close/error
  │                   ▼                   ▼
  └──────────── (CLOSED | RECONNECTING) ◄─┘
                        │
                        └──retry success──► CONNECTING
```

States: `IDLE`, `CONNECTING`, `CONNECTED`, `RECONNECTING`, `CLOSED`.

Transitions are **guarded**: an event that is not a legal transition from the
current state is rejected/ignored explicitly rather than silently doing nothing.
This makes the v1 `close`/`closed` class of bug impossible by construction.

The FSM exposes a small, **bounded, observable** state for framework bindings:

```ts
interface ConnectionState {
  status: "idle" | "connecting" | "connected" | "reconnecting" | "closed";
  lastError?: Error;
  retryAttempt: number;
  queueLength: number;
}
```

Observable via `subscribe(listener)` / `getState()` so a React
`useSyncExternalStore` adapter (and Vue/Svelte equivalents) is trivial. This is
the **only** state core owns. It never grows unbounded.

### 4.3 Codec — the wire seam

Every message crosses encode/decode, so it is a first-class option, not
middleware:

```ts
interface Codec<TWire = string | ArrayBufferLike | Blob> {
  encode(message: unknown): TWire;
  decode(data: TWire): unknown;
}
```

Default codec is JSON (with safe parse fallback to the raw value). Alternative
codecs (`durablews/msgpack`, the socket.io framing) are swapped in via config:

```ts
const client = defineClient({ url, codec: msgpackCodec });
```

### 4.4 Middleware — the extension crown jewel

The middleware pipeline (the Hono `app.use` analog) is retained and elevated. It
runs over the message pipeline in both directions (inbound and outbound) for
cross-cutting behavior: auth, logging, ping/pong, retry hooks, metrics.
Middleware **intercepts**; it does not add public API.

The existing event-bus and pipeline implementation survive largely intact. The
generic action/dispatch/reducer surface is removed as a public concept.

### 4.5 Events — how messages are delivered

Messages flow `onmessage → codec.decode → inbound middleware → emit`. Handlers
receive a message and forget it; nothing is retained in state. Typed:

```ts
const off = client.on<ChatMessage>("message", (msg) => { /* ... */ });
```

### 4.6 Plugins — the only thing that adds new client API

Most add-ons are **middleware** or **codecs**, named by their seam. The one
category that is neither — things that add *new client methods* (e.g.
`client.channel("room")`, presence) — are **plugins**. (If channels turn out to
be the only such case we may simply call it "the channels API"; the plugin
concept exists for when third parties need the same capability.)

The word "packs" is explicitly rejected.

### 4.7 Primary API (sketch — subject to refinement during M1)

```ts
import { defineClient } from "durablews";

const client = defineClient({
  url: "wss://example.com/socket",
  // durable by default — these are ON unless disabled:
  // reconnect: { backoff: "exponential", maxRetries: Infinity },
  // queue: true,
  // idle: { timeout: 30_000 },
  // codec: jsonCodec,
});

client.on("open", () => {});
client.on("message", (msg) => {});
client.on("close", (e) => {});

client.send({ type: "hello" }); // queued if not yet open
client.connect();
client.close();

client.use(authMiddleware);     // extension
```

`defineClient(config)` returns a **fresh instance every call.** The v1
module-level singleton caching (which silently ignored config on the second
call) is removed. Apps that want a singleton export their own instance.

## 5. Packaging, repo layout & naming

- **pnpm monorepo**, but **one published package** (`durablews`). Optional
  add-ons ship as **subpath exports** (`durablews/socketio`, `durablews/msgpack`,
  `durablews/auth`) and are tree-shakeable. Install stays `npm i durablews`. A
  separate package is introduced later only if something truly should not be
  bundled.
- There is **one core client**, not a base-vs-full split.

```
durablews/                 (repo root, pnpm workspace)
  packages/
    durablews/             ← the published library
      src/
        helpers/           ← internal building blocks (name retained)
        ...
      package.json         ← files: ["dist"], subpath exports
  docs/                    ← Astro 5 + Starlight site (deployed to CF Workers)
    src/content/
      docs/                ← guides, reference, getting-started
      rfcs/                ← RFC content collection (this document lives here)
  examples/                ← runnable examples / playgrounds
```

**RFCs are an Astro content collection**, not a stray folder — modelled on the
Vue RFC site. The collection has its own schema (frontmatter: `status`,
`author`, `created`, `supersedes`, etc.) and is the durable mechanism for all
future design changes, rendered on the docs site. This document's frontmatter
will be normalized to that schema when the site is scaffolded.

### Third-party plugin naming convention

Community add-ons should follow a single convention (to be documented in
CONTRIBUTING), e.g. `durablews-plugin-<name>`, so the ecosystem is consistent
and discoverable. Officially-shipped add-ons live inside the one package under
subpath exports.

## 6. Testing — first-class test pyramid

The pyramid is established in **M1**, not deferred:

- **Unit (base):** pure logic — FSM transitions, backoff math, queue behavior,
  codec encode/decode. No sockets. (vitest)
- **Integration (middle):** the client driven against a mock WS server
  (`vitest-websocket-mock`) — full lifecycle, reconnection flush, idle
  detection, middleware ordering.
- **Cross-runtime e2e (top, load-bearing):** the client against a *real*
  WebSocket server, executed in *real* runtimes — Node, a browser via
  Playwright, and at least one of Deno/Bun. This tier verifies the multi-runtime
  claim; an untested claim is a false claim.

Tests must assert **state correctness**, not merely that events fired (the gap
that hid the v1 close bug).

## 7. Tooling, CI & deployment

- **Package manager:** pnpm (workspaces).
- **Lint + format:** **Biome** — replaces ESLint + Prettier + their plugins with
  one fast tool. Known trade-off: Biome lints the AST and does not yet do
  *type-aware* rules; acceptable for a small zero-dep lib under `strict` `tsc`,
  which covers the type-level checks.
- **Build:** **tsup** (esbuild) — purpose-built for libraries; emits dual
  ESM/CJS + `.d.ts` with minimal config. Replaces the v1 Vite library-mode +
  `vite-plugin-dts` setup (Vite is kept only for the docs/app side via Astro).
- **Test:** **Vitest** (unit + integration) and **Playwright** (browser e2e);
  Deno/Bun runners for their respective cross-runtime e2e.
- **Versioning & release:** **changesets** — versioning, generated CHANGELOG,
  and automated npm publish.
- **Publish validation (in CI):** **publint** + **@arethetypeswrong/cli** —
  verify `exports`/types resolve correctly across ESM/CJS/bundlers.
- **Git hooks:** **lefthook** — fast pre-commit lint/format on staged files.
- **Dead-code/dep hygiene:** **knip** (optional, nice-to-have) — flags unused
  files, exports, and dependencies.
- **Docs site:** Astro **5** + Starlight (not Astro 6 — out but still buggy).
  In-repo, docs-as-code. Chosen over Mintlify (SaaS/vendor lock-in, cost).
- **Docs deploy:** Cloudflare **Workers** (not Pages — different adapter,
  static-assets model, and `wrangler` deploy), via CI on merge to `main`.
  First-class, not an afterthought.
- **CI:** runs on PRs (not just push), and must typecheck + Biome lint + build +
  run the full pyramid + publish validation (publint/attw).
- **Release:** changesets-driven automated publish of the lib to npm (the only
  published artifact); `files`/`exports` scope exactly what ships.
- **Branch strategy:** work on `main` during v2 development (no users to
  protect); once v2 lands, lock `main` and require PRs (branch protection).

## 8. Milestones

OSS hygiene, tooling, CI, and docs *infrastructure* are **foundational, not a
trailing phase** — they land up front and are treated as first-class. Only API
*documentation content* trails, because it requires a stable API.

- **M1 — Repo foundation.** pnpm monorepo scaffold; full tooling (formatter +
  linter, build, release/versioning, package-publish validation, Git hooks);
  OSS hygiene (CONTRIBUTING incl. plugin naming convention, SECURITY,
  CODE_OF_CONDUCT, issue/PR templates, CHANGELOG); CI on **PRs** (typecheck +
  lint + build + test-pyramid skeleton + publish validation); Astro 5/Starlight
  site scaffold with the **RFC content collection**, deployed to Cloudflare
  Workers. Structural only — no behavior change.
- **M2 — Core rewrite & correctness.** Typed connection FSM; codec seam;
  middleware pipeline retained; event delivery; drop singleton caching; remove
  messages-in-state; fix the close/error bug; strip console noise. Full test
  pyramid populated for the core. Everything green.
- **M3 — Durability.** Reconnection + exponential backoff, message queueing,
  idle detection — on by default, each with unit + integration + e2e coverage.
- **M4 — Docs content, first add-ons & 2.0 release.** API reference + guides +
  migration content on the site; first codecs/middleware/plugins as subpath
  exports; automated npm release of `durablews@2.0.0`.

## 9. Open questions

- Exact default values for reconnection (max retries, base delay, jitter, cap)
  and idle timeout — to be settled in M2 with tests.
- Whether `connect()` returns a promise that resolves on first open, and how it
  interacts with auto-reconnect.
- Final primary-API surface (names of options, event names) — refined during M1.
- Whether channels are the only plugin-shaped feature (which would let us drop
  the umbrella "plugin" concept from the public vocabulary).
```
