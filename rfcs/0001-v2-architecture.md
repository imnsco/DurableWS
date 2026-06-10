# RFC 0001 — DurableWS v2 Architecture

- **Status:** Implemented (shipped as `durablews@2.0.0`, 2026-06-10)
- **Author:** Nate Smith
- **Created:** 2026-06-08
- **Supersedes:** the v1.x design (published as `durablews@1.0.1`)

> **This RFC is frozen.** It is the record of the v2 design and its
> implementation (milestones M1–M4). Ongoing planning lives in
> [ROADMAP.md](../ROADMAP.md); future architecture-level changes get a new
> RFC — see [rfcs/README.md](README.md) for the process.

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

### 2.1 Positioning & competition

The casual framing "a modern alternative to socket.io" is directionally useful
but technically wrong for a client-only library: socket.io's gravity is
**server-side** (rooms, namespaces, broadcast), its clients cannot talk to plain
WS servers, and its users cannot migrate to us. socket.io defines the *category
expectations*, not the actual contest.

The real incumbents in our niche — durable clients over the standard
`WebSocket` — are:

- **`reconnecting-websocket`** — the long-standing default for "WebSocket that
  reconnects" (hundreds of thousands of weekly downloads) and effectively
  **abandoned**. This is the market being taken.
- **`partysocket`** — the maintained fork (PartyKit/Cloudflare), actively
  growing. This is the rival evaluators will compare us against.

Differentiation vs. both: typed events, the codec seam, middleware, **bounded
and observable queueing**, a promise-based `connect()`, and an observable FSM.
*(Correction, M4 slice 4: an earlier revision claimed "partysocket does not
queue" — false. Both incumbents buffer while disconnected, unbounded by
default with a silent `maxEnqueuedMessages` cap. The honest differentiator is
the queue's edges: bounded by default, drop-oldest, and every drop observable
via `drop` events — never a silent buffer.)* This story must be explicit — a
comparison page is among the highest-leverage docs we can ship (M4).

Both incumbents win adoption via a **drop-in `WebSocket`-compatible class**
(swap `new WebSocket(url)` → `new PartySocket(...)`). Our nicer API is a
*migration cost* for that audience; a thin `durablews/compat` subpath export
wrapping core in the standard `WebSocket` shape could capture it without
compromising the primary API (decision tracked in §9).

**Popularity has mechanics, and they are scheduled work, not afterthoughts**
(all M4): framework bindings (React first — a copy-pasteable hook is worth more
adoption than any single core feature), typed messages as the DX showcase,
bundle-size as a marketed asset (zero-dep, few KB — size badge in CI),
comparison pages, `llms.txt` on the docs site (AI assistants are a top
discovery channel), runnable `examples/`, and a launch post ("we fixed
reconnection properly: full jitter, bounded queues, an FSM").

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

> **Status note:** both directions are built — the **inbound** pipeline
> shipped in M2, the **outbound** pipeline in M4 slice 3 (object form of
> `use()`; semantics in §9). Heartbeat pings deliberately bypass the outbound
> pipeline.

Four distinct seams, deliberately kept separate:

1. **Connection FSM** — owns lifecycle state and transitions.
2. **Codec** — the wire format (`encode`/`decode`).
3. **Middleware** — cross-cutting behavior over the message pipeline.
4. **Events** — how the user receives messages and lifecycle notifications.

### 4.2 Connection state: a typed finite state machine

The connection lifecycle is a finite state machine, not a generic reducer:

*(This section reflects what shipped in M2; `reconnecting` arrives in M3.)*

```
idle ──connect()──► connecting ──open──► open
  │                     │                  │
  │            close()  │  closed          │ close() ──► closing ──► closed
  │                     ▼                  │                            │
  └──────────────────► closed ◄────────────┘          connect() ────────┘
                        (M3: closed-unexpectedly ──► reconnecting ──► connecting)
```

States (lowercase, matching the web platform's vocabulary): `idle`,
`connecting`, `open`, `closing`, `closed` — plus `reconnecting` in M3.

Transitions are **guarded by a transition table** (`fsm.ts`): an illegal
`(state, event)` pair is the *absence of a table entry* and is rejected
explicitly rather than silently doing nothing. This makes the v1
`close`/`closed` class of bug impossible by construction. Transport errors are
deliberately *not* FSM events — an `error` does not itself change connection
state (the subsequent `close` performs the transition); errors are recorded
(`lastError`) and emitted out-of-band.

The client exposes a small, **bounded, observable** state:

```ts
client.state;                    // ConnectionState (live getter)
client.getState();               // frozen { state, lastError } snapshot
client.on("statechange", ({ previous, current }) => { /* ... */ });
```

`retryAttempt` and `queueLength` join the snapshot as M3's features land. The
`on("statechange")` + `getState()` pair is the `subscribe`/`getSnapshot` shape
a React `useSyncExternalStore` adapter needs (bindings are scheduled M4 work,
not an afterthought — see §2.1). This is the **only** state core owns. It never
grows unbounded.

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

### 4.6 Extension vocabulary — one word per seam

Every extension concept is **named by the seam it occupies**, and that word is
used consistently across code, docs, and this RFC:

| Term | What it is | Registered via | Adds client API? |
| --- | --- | --- | --- |
| **Middleware** | Intercepts messages on the pipeline — inbound and/or outbound, same word for both directions | `client.use(...)` | Never |
| **Codec** | Translates the wire format | `codec` config option | Never |
| **Plugin** | Adds new client capability (channels, presence) | TBD (M4+) | Yes — the only one |
| **Binding** | Adapts the client to a framework's reactivity | subpath import (`durablews/vue`, `durablews/react`) | n/a — framework surface, not client surface |

**Plugins** are the one category that adds *new client methods* (e.g.
`client.channel("room")`, presence). (If channels turn out to be the only such
case we may simply call it "the channels API"; the plugin concept exists for
when third parties need the same capability.)

**Bindings** are the neutral, cross-framework word (used in this RFC and in
comparison contexts); each framework's docs speak its community's tongue — a
Vue *composable*, a React *hook* (settled M4 decision). Those words name the
*form* the binding takes in that framework, not a separate concept.

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
  `durablews/auth`) and are tree-shakeable — **including framework bindings**
  (`durablews/vue`, `durablews/react`), whose framework peers are *optional*
  peerDependencies (see M4 decisions, §8). Install stays `npm i durablews`. A
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
  **Status (post-M2): browser ✅ (Playwright Chromium, required CI check);
  Node-as-client ⬜; Deno/Bun ⬜.** By this section's own standard, the
  multi-runtime claim is only one-third verified — the remaining runtimes are
  scheduled M4 scope (§8).

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
- **Advisory next-TypeScript typecheck (planned):** a `typecheck:next` script +
  **non-blocking** CI job running `tsc` from `typescript@next`. Rationale: a
  TS 6.0-nightly editor flagged a real type hole (`Codec.encode` returning
  `SharedArrayBuffer`-compatible types that `WebSocket.send` rejects under
  6.0's stricter `lib.dom.d.ts`) that stable `tsc` cannot see. Gating merges on
  a nightly compiler is a footgun, so the job is advisory — it makes
  next-TypeScript breakage visible without blocking. (The code fix itself lands
  via PR #18's thread.)
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

### M3 — Durability ✅

Reconnection + exponential backoff, message queueing, idle detection. Each lands
as its own slice with unit + integration + e2e coverage.

**Decisions (settled):**

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
- **Idle detection is opt-in, not on by default** (overrides the original
  "on by default" note). A naive "no inbound traffic → reconnect" harms
  legitimately-quiet-but-healthy connections, and any heartbeat depends on
  app-level ping semantics the library can't assume. Ship it as
  `heartbeat?: { interval, message?, timeout }` — when set, ping every
  `interval` and force a reconnect if nothing arrives within `timeout`; off
  otherwise.

**Slices** (each a green, independently reviewable PR). Unlike M2, the e2e
harness already exists, so each slice carries its own unit + integration + e2e
coverage *and* its docs update ("roadmap → what works today") in-PR — there is no
separate test/e2e slice.

- ✅ **Slice 1 — Reconnection + backoff.** `reconnecting` FSM state +
  `RETRY` event; pure backoff module (`backoff.ts` — full-jitter math with
  injectable randomness, deterministically unit-tested); retryable-close policy
  (user `close()` never retried; `shouldReconnect` veto; `maxRetries` budget);
  `reconnecting` event (`{ attempt, delay }`, ordered statechange → close →
  reconnecting); `retryAttempt` joins `getState()`. `connect()` survives failed
  attempts and settles only on first open or terminal failure
  (retries-exhausted / veto / user close-before-open); manual `connect()`
  during `reconnecting` skips the backoff wait. E2e: server drops the socket
  (code 1012) → real Chromium transparently reconnects and round-trips.
- ✅ **Slice 2 — Message queueing.** `send()` queues during
  `connecting`/`reconnecting` (un-encoded values, so `drop` hands back exactly
  what was passed); bounded drop-oldest (`queue.ts`, default 256) with a `drop`
  event (`{ data, reason: "overflow" | "close" }`); flush in order on open,
  *before* the `open` event (backlog precedes anything an open-handler sends);
  user `close()` and terminal failure drop the queue as `drop` events — never
  silently lossy. `queueLength` joins `getState()`; `send()` still throws in
  `idle`/`closing`/`closed` and (always) under `queue: false`. E2e: a message
  sent while the server is down flushes after the transparent reconnect.
- ✅ **Slice 3 — Idle detection / heartbeat.** Opt-in
  `heartbeat: { interval, message?, timeout? }` (`heartbeat.ts`; message
  defaults to `"ping"`, timeout to the interval). While open: ping every
  interval; *any* inbound frame counts as liveness; a silent deadline emits an
  `error`, force-closes with app-reserved code **4408**
  (`HEARTBEAT_TIMEOUT_CODE`, exported for `shouldReconnect` filtering), and the
  close flows into the normal reconnect machinery (not user-initiated →
  retryable). `lastError` widened to `Event | Error`. E2e: server goes silent
  ("mute") → real Chromium detects the dead link via heartbeat and recovers on
  a fresh connection.

### M4 — Adoption: docs, bindings, typed DX & 2.0 release ✅

Renamed from "docs content & add-ons" — M4 is the **adoption milestone**. The
premise (§2.1): libraries don't become popular at 1.0; they become popular when
a developer copies a working hook or composable from a docs page.

**Decisions settled for M4:**

- **Vue is a first-class binding, co-equal with React** (not a fast-follow).
  Rationale beyond preference: React WebSocket hooks are a crowded space
  (`react-use-websocket`, partysocket's hook); polished Vue support is
  genuinely underserved — a niche we can own, and the maintainer dogfoods Vue.
  Docs use each community's vocabulary: *composables* (Vue), *hooks* (React).
  Svelte remains a fast-follow.
- **Bindings ship inside the one package as subpath exports**
  (`durablews/vue`, `durablews/react`) — this is §5's existing
  one-package/subpath rule applied, re-affirmed for bindings specifically:
  one install, one npm page concentrating downloads (social proof), versioning
  that can never drift from core, IDE-discoverable exports — Hono-style, vs.
  the TanStack/XState separate-package model whose independent-versioning win
  costs fragmentation we have no team to absorb. Mechanics: `vue`/`react` as
  **optional peerDependencies** (`peerDependenciesMeta.optional`) so core
  installs never warn and framework code loads only via its subpath. If a
  binding ever needs independent majors, extraction later is easy; merging
  back is hard.
- **Reactive-state seam:** `on("statechange")` fires only on FSM transitions,
  but `queueLength` changes on `send()` with no transition — insufficient for
  reactive bindings. Slice 2 adds a small core `subscribe(listener)` seam
  firing on **any** observable-snapshot change (state, lastError, retryAttempt,
  queueLength); it is exactly React's `useSyncExternalStore` shape and drives
  Vue's `shallowRef` equally well.
- **Alpha cadence:** publish `2.0.0-alpha.N` to npm as M4 slices merge —
  early adopters finding the library *is* the milestone's thesis; waiting for
  2.0.0 to publish anything contradicts it.

**Slices** (each a green, reviewable PR; tests + docs travel in-PR). Order is
deliberate: typed maps stabilize the core surface first so bindings and the
API reference are typed from day one; docs content lands after the surface
stops moving; release is last.

- ✅ **Slice 1 — Typed messages + Standard Schema validation.** Generics
  threaded through the surface — `WebSocketClient<TIn, TOut>`:
  `on("message")` receives `TIn`, `send()` accepts `TOut`, `drop` carries
  `DropEvent<TOut>`, middleware context is `MessageContext<TIn>` (defaults
  `unknown`, fully back-compatible). `config.schema` takes any **Standard
  Schema** (interface vendored types-only per the spec — still zero deps);
  `defineClient({ url, schema })` **infers `TIn` from the schema**, no
  generics needed. Validation runs decode → schema → middleware, so middleware
  only sees trusted data; invalid inbound surfaces as an `error` event
  (`SchemaValidationError` with the spec's issues), never as `message`; async
  `validate` supported. Compile-time tests via `expectTypeOf` + runtime
  validation suite.
- ✅ **Slice 2 — Reactive seam + Vue & React bindings.** *(Landed as two PRs:
  2a the core seam; 2b the bindings.)* Core
  `subscribe(listener)` over the full snapshot (per the decision above) —
  including the `getState()` **snapshot caching** that referential-equality
  consumers like `useSyncExternalStore` require — then
  `durablews/vue` (`useWebSocket` composable: reactive state, auto-cleanup on
  scope dispose) and `durablews/react` (`useWebSocket` via
  `useSyncExternalStore`) as subpath exports with optional peers (`vue >=3.2`,
  `react >=18`). Shared semantics: pass a *config* and the binding owns the
  client (auto-connect, SSR-safe, closed on dispose/unmount); pass an
  *existing client* and the binding only observes it — the app-singleton
  sharing pattern. Both expose the snapshot fields plus a bounded
  `lastMessage` (latest message only — core still never accumulates history)
  and infer types from `config.schema`. Each has a docs page in its
  community's idiom (composables / hooks). First `2.0.0-alpha` publish with
  bindings included.
- ✅ **Slice 3 — Outbound middleware.** Implements the settled §9 decision:
  mirrored onion via the object form of `use()`
  (`use({ inbound?, outbound? })`; a bare function stays inbound). All five
  settled semantics shipped: transmission-time execution (after dequeue,
  before encode), ordered async via a serialized outbound chain with a fully
  synchronous fast path when nothing is in flight, silent short-circuit,
  per-message error isolation, heartbeat bypass. One semantic the design
  left implicit, now defined and tested: a message whose connection drops
  *mid-pipeline* is re-queued ahead of newer sends when a retry is underway
  (middleware re-runs at next transmission — tokens stay fresh) and surfaces
  as a `drop` otherwise — never silently lost. New types: `OutboundContext`,
  `OutboundMiddleware`, `DirectionalMiddleware`. Corrects the §4.1 status
  note; e2e proves async stamping + ordering against a real socket.
- ✅ **Slice 4 — Docs content.** API reference (hand-written single page —
  typedoc deferred until the surface outgrows it), guides (durability
  tuning, middleware, codecs; framework pages landed in slice 2b),
  migration-from-v1, the **comparison page** ("Why DurableWS?" — claims
  verified against the incumbents' current READMEs, with an explicit
  "what they do better today" section: drop-in compat, dynamic URL
  providers, production miles), and **`llms.txt`** (hand-written, in
  `docs/public/`) for AI-assistant discovery. Also corrects §2.1's false
  "partysocket does not queue" claim (see the correction note there).
- ✅ **Slice 5 — `durablews/compat` (decision: build, with scoped fidelity).**
  `DurableWebSocket` (also exported as `WebSocket`) — an `EventTarget`-based,
  `WebSocket`-shaped class over core for the two documented audiences:
  app-code one-line migration and **`webSocketImpl`-style injection**
  (graphql-ws, y-websocket examples in the docs). Wire-faithful by
  construction (identity codec — no JSON); Level0 (`onopen`/…) + Level2
  (`addEventListener`) event styles; constructor third arg takes the
  durablews config; the full client is exposed as `.client` (escape hatch to
  `drop`/`reconnecting`/middleware). The **known-deviations table** lives on
  the docs page (readyState re-enters `CONNECTING` across reconnects;
  send-while-connecting queues; `protocol`/`extensions`/`bufferedAmount`
  stubs; post-construction `binaryType` emulated via order-preserving Blob
  conversion with a `FileReader` fallback for jsdom). Core gained one small
  option in support: `binaryType`, applied to the socket on every
  (re)connect — generally useful for binary protocols, not compat-specific.
  E2e: the compat class survives a server drop in real Chromium.
- ✅ **Slice 6 — Cross-runtime e2e + distribution assets.** One smoke script
  (`e2e/runtime-smoke.mjs` — lifecycle walk, JSON echo, transparent
  reconnect after a server drop, queue-flush-after-recovery) runs unchanged
  under **Node 22, Deno 2, and Bun** against the built bundle + a real echo
  server, as three required CI jobs — §6's multi-runtime claim is now
  proven, not stated (browser was already covered by Playwright).
  **size-limit** budgets enforced in CI (brotli, minified, all deps): core
  **3 KB** (measures 2.36), vue/react 3.5 KB, compat 4 KB; README badges
  (npm@alpha, CI, size). Runnable **`examples/`** (workspace members, built
  in CI): `resilience-playground` (sabotage-the-server flagship),
  `chat` (Vue + React against one server + one zod schema),
  `collab-notepad` (raw-WebSocket app made durable via the compat one-line
  swap). *Example-3 rescope, decided during implementation:* the planned
  y-websocket/Yjs injection demo was dropped — y-websocket runs its own
  reconnection (stateful sync protocols must), so injecting a
  self-reconnecting socket creates two fighting recovery layers; the
  **layering rule is now documented in the compat guide** ("one reconnector
  per stack", with a `reconnect: false` wrapper recipe), and the example
  demonstrates compat where it genuinely owns durability: plain-pipe code.
- ✅ **Slice 7 — 2.0 release.** **`durablews@2.0.0` is live on npm `latest`**
  (published 2026-06-10 via OIDC trusted publishing, with provenance
  attestations) — the maintainer merged the Version Packages PR (#40) as the
  deliberate human step. Release-pipeline hardening landed along the way:
  the Version PR's required checks never started because pushes made with
  the built-in `GITHUB_TOKEN` don't trigger workflows (GitHub's recursion
  guard); fixed by giving the `RELEASE_TOKEN` fine-grained PAT to **both**
  the changesets step's env (#43) *and* `actions/checkout`'s `token` (#44 —
  the action pushes through git, which uses checkout's persisted
  credentials). Version PRs now arrive with live checks, unassisted.
  Remaining launch chore (outside the repo): flip the launch post to
  `draft: false` in `imns-co-astro`.

## 9. Open questions

- ~~Exact default values for reconnection (max retries, base delay, jitter, cap)
  and idle timeout.~~ **Settled in M3** — reconnect: `baseDelay 500ms`,
  `factor 2`, `maxDelay 30s`, full jitter, `maxRetries Infinity`; queue bounded
  at 256 (drop-oldest); idle detection opt-in (no default timeout). See M3 above.
- ~~Whether `connect()` returns a promise that resolves on first open, and how
  it interacts with auto-reconnect.~~ **Settled in M2** — resolves on first
  open; idempotent; rejects only on terminal failure (see M2 above).
- ~~Final primary-API surface (names of options, event names).~~ **Event names
  settled in M2** — standard `WebSocket` vocabulary (`open`/`message`/`close`/
  `error`/`statechange`). Option names refined as each seam lands.
- Whether channels are the only plugin-shaped feature (which would let us drop
  the umbrella "plugin" concept from the public vocabulary).
- **AsyncAPI / OpenAPI integration (v2.x idea — recorded 2026-06-09, not
  scheduled).** OpenAPI itself cannot describe WebSocket message flows — it
  is an HTTP request/response spec; the async-world equivalent is
  **AsyncAPI**, which has first-class WebSocket bindings (channels, message
  schemas). Core already has the right seams and needs nothing added:
  `schema` accepts any Standard Schema, so an AsyncAPI document's message
  schemas (JSON Schema) can validate inbound traffic today through a
  json-schema→Standard-Schema adapter. The product-shaped idea is
  **codegen** — a `durablews-asyncapi` tool that generates a typed client
  (channel definitions, message unions, validators) from an AsyncAPI
  document. Post-2.0 growth item, alongside the socket.io codec.
- **OpenTelemetry (v2.x idea — recorded 2026-06-10, not scheduled).** Core
  needs nothing: the existing seams already expose every signal an
  instrumentation wants — middleware (both directions) for message
  spans/counts, `subscribe()`/`getState()` for state and queue-depth
  metrics, and the event vocabulary (`reconnecting`, `drop`, `error`,
  close code 4408) for the durability story. The product-shaped version is
  a small `durablews/otel` subpath (a middleware + subscriber pack over
  `@opentelemetry/api` as an optional peer, like the framework bindings).
  Honest caveats before scheduling it: OTel has **no stable semantic
  conventions for WebSockets** (we'd be inventing attribute names), and
  browser-side OTel adoption is thin — the audience is Node/edge
  service-to-service clients, real but a minority. Decide on demand;
  userland can build it today against the public seams.
- ~~`connect()` can never settle under default config.~~ **Settled in M3
  slice 1: pending-forever is by design.** Under `maxRetries: Infinity` the
  client is *still working* — a rejection would be a lie, and a built-in
  `connectTimeout` would duplicate what userland does in one line
  (`Promise.race([client.connect(), timeout(ms)])`) while complicating the
  contract. Escape hatches: finite `maxRetries`, `shouldReconnect`, or the
  race. Documented prominently in the `connect()` JSDoc and getting-started.
- ~~`durablews/compat` — build or reject?~~ **Settled: build, with scoped
  fidelity** (M4 slice 5). Faithful for two documented use cases — app-code
  drop-in and `webSocketImpl`-style injection — with a published known-
  deviations table rather than spec perfection. See §8 M4 slice 5.
- ~~**Outbound middleware shape** — same onion pipeline mirrored, or a distinct
  hook (`onSend`)? Auth (token attach/refresh) is the driving use case.~~
  **Settled (M4 slice 3 design): mirrored onion, registered through an object
  form of `use()`.** A bare function stays inbound (unchanged, the common
  case); an object registers per direction:

  ```ts
  client.use((ctx, next) => { ... });                  // inbound (as today)
  client.use({ outbound: attachToken });               // outbound only
  client.use({ inbound: logIn, outbound: logOut });    // one logical
                                                       // middleware, both
                                                       // directions
  ```

  Why an onion and not an `onSend` hook: the driving use case — attaching a
  *fresh* auth token, refreshing it when expired — is **async and
  composable**, exactly what a hook is not. One pipeline model for both
  directions also keeps the mental model singular ("middleware intercepts
  messages"), and the object form gives a logical middleware (auth, logging,
  metrics) a single registration site instead of a second method
  (`useOutbound`) growing the API.

  Semantics (the load-bearing decisions):

  - **Runs at transmission time** — after dequeue, before `codec.encode` —
    not at `send()` time. A message queued across a 30s reconnect gets a
    token that is fresh *when it actually goes out* (the entire point of the
    use case), and the queue keeps storing exactly what the user passed to
    `send()`, so `drop` events keep handing back untransformed values
    (existing invariant, unchanged).
  - **Async is ordered.** Outbound middleware may return a promise (token
    refresh); the outbound path serializes so messages reach the socket in
    `send()` order even when an earlier message's middleware awaits. When no
    middleware returns a promise (the common case), `send()` stays fully
    synchronous — zero overhead.
  - **Short-circuit = not sent, silently.** Returning without calling
    `next()` is deliberate policy (filtering), not durability loss — no
    `drop` event (`drop` means "the library couldn't deliver this", not "you
    chose not to send it").
  - **Errors are per-message.** A throw/rejection surfaces as an `error`
    event; that message is not sent; subsequent messages continue (same
    isolation the queue flush already has).
  - **Heartbeat pings bypass outbound middleware.** They are transport-level
    liveness, not app messages — an auth or logging middleware seeing
    synthetic pings would be surprising, and a middleware that drops or
    delays them would silently break dead-link detection.

  Use-case grounding — async is required by the platform, not hypothetical:

  - **Auth token refresh** — await the refresh endpoint, attach, send (the
    driving case).
  - **Payload signing / encryption** — WebCrypto (`crypto.subtle.sign` /
    `.encrypt`) has *no synchronous API*; E2E-encrypted or HMAC-signed
    messages require async middleware.
  - **Compression** — `CompressionStream` is likewise async-only.
  - **Pacing** — a semaphore/throttle that awaits a send slot, preserving
    order.
  - **Outbox journaling** — await an IndexedDB write before transmit, for
    exactly-once-across-page-reloads semantics.

  And one boundary stated honestly. The pipeline transforms **the stream of
  already-committed messages**, and order is part of what the stream means —
  so ordered delivery implies head-of-line blocking: a middleware that
  delays one message delays everything behind it. That is *correct* for
  every case above (pacing means delaying the whole stream; a token refresh
  blocking sends is what freshness requires). The alternative — running
  per-message pipelines concurrently and writing in completion order —
  silently reorders messages whenever latencies differ, a data-corrupting
  failure mode for any create-then-update sequence.

  Policies that decide **whether and when a `send()` call becomes a message
  at all** — per-key debounce, batching, dedupe — are a different
  *composition layer*, not a different mechanism. As middleware they would
  have to hold message N while letting N+1 pass (reordering, which the
  pipeline refuses) and would see every message, needing filter config to
  scope themselves. As plain wrappers in front of `send()` they get both
  for free, and remain fully composable — function composition at the call
  site instead of pipeline composition over the stream:

  ```ts
  const sendTyping = debounce((s) => client.send(s), 300);
  ```

  Nothing here is "built in instead": such wrappers are userland (at most a
  future recipes page / helpers module of send-wrappers — decide on demand,
  M4 slice 4 at the earliest), and core ships neither. This is the layering
  every middleware system has — rate limiting is Express/Hono middleware,
  request coalescing happens in the caller; TCP batches via Nagle but never
  reorders your bytes. Routing decomposes the same way: inbound routing
  (dispatch by message type) is inbound middleware today and the channels
  plugin (§4.6) tomorrow; the outbound half is enveloping — stamping
  topic/destination onto each frame — a plain sync transform.
```
