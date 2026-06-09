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
- Multi-runtime via the standard global `WebSocket`: browser, Node ≥22 (the
  floor where the global `WebSocket` ships unflagged), Deno, Bun, edge.
  **Proven by cross-runtime e2e tests, not merely claimed.**
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
    src/content/docs/      ← user-facing docs: guides, reference, getting-started
  rfcs/                    ← design RFCs (repo-internal markdown; this document)
  examples/                ← runnable examples / playgrounds
```

**RFCs live as repo-internal markdown in top-level `rfcs/`** (not on the
published docs site, for now). RFC 0001 currently doubles as the live
implementation tracker (§8), which is a contributor artifact rather than
polished public content, so the Starlight site ships user-facing docs only in
M1. Publishing RFCs to the site — e.g. as a dedicated Astro content collection
with its own schema, Vue-RFC-style — is revisited in M4 once the API and this
document's role have stabilized.

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

## 8. Implementation plan & status

OSS hygiene, tooling, CI, and docs *infrastructure* are **foundational, not a
trailing phase** — they land up front and are treated as first-class. Only API
*documentation content* trails, because it requires a stable API.

This section is the **live execution tracker** — the project uses doc-based
tracking (no GitHub issue board), so this is kept current as work lands.
Status: ✅ done · 🚧 in progress · ⬜ not started.

### M1 — Repo foundation ✅

Structural only — no behavior change to the library.

- ✅ **Slice 1 — Monorepo scaffold + core tooling.** pnpm workspace; library
  moved to `packages/durablews`; Vite library-mode → tsup (ESM + CJS + dual
  `.d.ts`); ESLint + Prettier → Biome; package set to `2.0.0-alpha.0`.
  (commit `fe6faae`)
- ✅ **Slice 2 — CI, release & publish tooling.** CI on PRs + pushes (Node
  22/24 matrix; Biome, typecheck, build, test, publint + attw); changesets
  (access: public); lefthook pre-commit; `engines` corrected to Node ≥22;
  `tsconfig` `baseUrl` anti-pattern removed. (commits `5b1c7c9`, `0fbd214`,
  `a4d4b2a`)
- ✅ **Slice 3 — OSS hygiene.** Corrected package README (durability features
  framed as roadmap; Node ≥22 stated) + root README; CONTRIBUTING (incl. the
  `durablews-plugin-*` naming convention and changesets workflow); SECURITY;
  Contributor Covenant CODE_OF_CONDUCT; issue forms + PR template.
  (commit `12012c1`)
- ✅ **Slice 4 — Docs site.** Astro 5 + Starlight site in `docs/` (user-facing
  content only — landing + getting-started); RFCs kept as repo-internal
  `rfcs/` markdown (site publishing of RFCs deferred to M4). Built for
  Cloudflare Workers via the `@astrojs/cloudflare` adapter (emits a Worker +
  asset bundle, configured in `wrangler.jsonc`), domain `durablews.imns.co`;
  deploy workflow gated on a `DOCS_DEPLOY_ENABLED` repo
  variable until CF secrets + DNS are set. Added a required `Docs` CI job.
  (commit `ce286df`)

### M2 — Core rewrite & correctness ✅

Typed connection FSM; codec seam; middleware pipeline retained; event delivery;
drop singleton caching; remove messages-in-state; fix the close/error bug; strip
console noise. Full test pyramid populated for the core. Everything green.

**Decisions settled for M2:**

- **The generic store is removed**, not retained. `defineStore` / `dispatch` /
  `defineAction` / `composeActions` / `HandlerFn` are deleted. A free-form
  reducer is the wrong tool for a connection lifecycle — it has no concept of an
  illegal transition, which is precisely what allowed `dispatch("close")` to be
  a silent no-op (the close/error bug). State is *not* removed: it is replaced
  by (a) a typed FSM that forbids illegal transitions by construction and (b) a
  small read-only observable holding the current state (plus `lastError` and
  counters as durability lands). The middleware pipeline survives as a
  standalone module re-homed onto the message path.
- **Event names follow the standard `WebSocket` vocabulary:** `open`,
  `message`, `close`, `error`, plus `statechange`. (Today's `connected` →
  `open`.) We are pre-redesign and break freely.
- **`connect()` contract** (the stable-across-M2→M3 subset):
  - Resolves the first time the socket opens. *(Never changes.)*
  - Idempotent — concurrent/repeat calls return the same in-flight promise;
    calling while already open resolves immediately.
  - Rejection means **terminal** failure, not first failure. In M2 (no
    reconnect) a failed initial connection is terminal, so it rejects. In M3,
    reconnect redefines "terminal" as *retries exhausted*, so `connect()` stays
    pending across retries and rejects only when the library gives up — the
    meaning holds, only the definition of "terminal" tightens, so no API churn.
  - Ongoing failures after first open surface via `on("error")` / `on("close")`,
    not the promise. Docs note: `await` or `.catch` to avoid an unhandled
    rejection on fire-and-forget `connect()`.

**Slices** (each a green, independently reviewable PR; unit + integration tests
travel in-PR):

- ✅ **Slice 1 — FSM lifecycle core.** Typed connection FSM (`fsm.ts` —
  transition table over idle/connecting/open/closing/closed) replacing the
  store's lifecycle role; illegal `(state, event)` pairs are rejected, killing
  the close/error dead-transition bug. Standard `WebSocket` event vocabulary
  (`open`/`message`/`close`/`error`/`statechange`); read-only `state` +
  `getState()`. `defineClient` singleton dropped; messages-in-state and all
  console noise removed; `send()` throws when not open. Store, action handlers,
  and pingpong/logger middleware deleted (pipeline returns in slice 3).
  (commit `5c26af7`)
- ✅ **Slice 2 — Codec seam.** Pluggable `encode` / `decode` with a default JSON
  codec (`codec.ts` / `jsonCodec`); `config.codec` option. Replaced the inline
  JSON; folded `safeJSONParse` into the default codec; deleted the broken,
  unused `normalizeURL` (and the now-empty `utils.ts`). `Codec` + `jsonCodec`
  exported. (commit `aa71812`)
- ✅ **Slice 3 — Middleware pipeline (re-homed).** Standalone onion-model
  pipeline (`pipeline.ts`) on the decoded-message path; `client.use()` returns
  the client for chaining; short-circuit when a middleware skips `next()`;
  middleware errors surface as `error` (payload widened to `Event | Error`).
  `pingpong` is opt-in (`middleware.ts`); the default `logger` is gone.
  (commit `5a47c0c`)
- ✅ **Slice 4 — Test pyramid + e2e.** Filled integration gaps (unsubscribe,
  frozen `getState()` snapshot, full `statechange` sequence, `connect()` while
  closing). Added a Playwright browser e2e harness — real Chromium + real
  `WebSocket` against a local `ws` echo server, driving the built ESM bundle
  (connect/round-trip/close + reconnect). New `E2E` CI job, added to the branch
  ruleset's required checks. (commit `b35c511`)

Order is deliberate: the codec defines what "decoded" means, so it precedes the
middleware that operates on decoded messages.

### M3 — Durability ⬜

Reconnection + exponential backoff, message queueing, idle detection. Each lands
as its own slice with unit + integration + e2e coverage.

**Proposed decisions (pending sign-off — not yet settled):**

- **Reconnection.** On by default. Exponential backoff with **full jitter**
  (delay = random in `[0, min(maxDelay, baseDelay × factorⁿ)]`) to avoid
  thundering herd. Proposed defaults: `baseDelay 500ms`, `factor 2`,
  `maxDelay 30s`, `maxRetries Infinity` (truly durable). Reconnect on *any*
  close not initiated by the user's `close()`, with a `shouldReconnect(close)`
  predicate to override. Config: `reconnect?: false | { baseDelay?, factor?,
  maxDelay?, jitter?, maxRetries?, shouldReconnect? }`. This is also where
  `connect()`'s "terminal failure" tightens to *retries-exhausted* (per the M2
  contract) and the `reconnecting` FSM state is introduced.
- **Message queueing.** On by default. `send()` while not-open **queues**
  instead of throwing (the planned evolution of M2's throw) and flushes in order
  on (re)open. **Bounded** (`maxSize`, proposed default ~256) with
  **drop-oldest** + a `drop` event when full — never silently unbounded, never
  silently lossy. `send()` while `idle`/terminally-`closed` still throws. Config:
  `queue?: false | { maxSize? }`.
- **Idle detection — proposed change from the original "on by default."** A
  naive "no inbound traffic → reconnect" harms legitimately-quiet-but-healthy
  connections, and any heartbeat depends on app-level ping semantics the library
  can't assume. Proposed: ship it **opt-in** as
  `heartbeat?: { interval, message?, timeout }` — when set, ping every
  `interval` and force a reconnect if nothing arrives within `timeout`; off
  otherwise.

**Slices** (each a green, independently reviewable PR). Unlike M2, the e2e
harness already exists, so each slice carries its own unit + integration + e2e
coverage *and* its docs update ("roadmap → what works today") in-PR — there is no
separate test/e2e slice.

- ⬜ **Slice 1 — Reconnection + backoff.** `reconnecting` FSM state; backoff
  scheduler (fake-timer-tested); retryable-close policy; `reconnecting` event;
  `connect()` terminal semantics tightened to retries-exhausted. E2e: server
  drops the socket → transparent reconnect.
- ⬜ **Slice 2 — Message queueing.** `send()` queues while not-open; bounded
  with drop-oldest + `drop` event; flush-on-(re)open (rides slice 1's reconnect).
  E2e: queued sends flush after a reconnect.
- ⬜ **Slice 3 — Idle detection / heartbeat.** Opt-in keepalive + liveness
  timeout that forces a reconnect on a silent link. E2e: heartbeat-triggered
  recovery.

### M4 — Docs content, first add-ons & 2.0 release ⬜

API reference + guides + migration content on the site; first
codecs/middleware/plugins as subpath exports; automated npm release of
`durablews@2.0.0`.

## 9. Open questions

- Exact default values for reconnection (max retries, base delay, jitter, cap)
  and idle timeout — to be settled in M3 with tests.
- ~~Whether `connect()` returns a promise that resolves on first open, and how
  it interacts with auto-reconnect.~~ **Settled in M2** — resolves on first
  open; idempotent; rejects only on terminal failure (see M2 above).
- ~~Final primary-API surface (names of options, event names).~~ **Event names
  settled in M2** — standard `WebSocket` vocabulary (`open`/`message`/`close`/
  `error`/`statechange`). Option names refined as each seam lands.
- Whether channels are the only plugin-shaped feature (which would let us drop
  the umbrella "plugin" concept from the public vocabulary).
```
