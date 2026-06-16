# RFC 0002: Built-in Middleware & the Authoring Contract

- **Status:** Accepted
- **Author:** Nate Smith
- **Created:** 2026-06-16

> M5 milestone (see [ROADMAP.md](../ROADMAP.md)). Process:
> [rfcs/README.md](README.md). Builds on the middleware mechanism shipped
> in [RFC 0001](0001-v2-architecture.md): inbound in M2, outbound in M4
> slice 3 (the `§9` references below are to RFC 0001).

---

## 1. Summary

DurableWS shipped a middleware *mechanism* in 2.0: an onion pipeline,
inbound and outbound, registered through `use()`, with one middleware
already in the box (`pingpong`, the heartbeat keepalive). This RFC does
two things on top of it:

1. Promotes the middleware **authoring API** to a documented, **stable
   public contract**, the surface third-party packages and your own app
   middleware are written against, plus the semantic guarantees they may
   rely on. This is the part expensive to reverse, so it is the spine of
   the RFC.
2. Ships a small set of **built-in middleware** for the cross-cutting
   concerns every production WebSocket app re-implements (auth, logging,
   dedup) as tree-shakable named exports under a new
   `durablews/middleware` subpath.

It deliberately adds **no new core capability**. The mechanism exists;
this RFC formalizes its contract and populates the shelf.

## 2. Motivation

The toy-project middleware list is "logging and auth." The production
list is shaped by one fact already central to DurableWS: **reconnection
causes message replay.** A durable client queues across a drop and flushes
on reopen, and the server, unsure what you received, may resend. So the
concerns that separate a production client from a demo cluster around the
reconnect boundary:

- A token that was valid at `send()` is **stale** by the time a message
  queued across a 30s outage actually flushes. Outbound middleware running
  at transmission time is the fix (§9), but every app re-writes the
  token-attach glue.
- A server that recovers with **at-least-once** delivery resends messages
  it is unsure you received; the client wants to drop those duplicates
  inbound rather than process them twice.
- Everyone writes the same **logger**, and the production version isn't
  `console.log`; it's structured output with secrets/PII **redacted**.

These are universal, mechanical, and easy to get subtly wrong (timing,
bounded memory, ordering). They belong in the box. The line we hold:
**cross-cutting concerns are middleware; reliability features that add API
surface or require server cooperation are not** (see §3).

## 3. Scope

This RFC is **middleware only**. The 2.0 extension vocabulary (RFC 0001
§4.6) has four categories, and the items often lumped under "middleware"
mostly belong to the others. Redirected, explicitly:

| Idea | What it actually is | Home |
| --- | --- | --- |
| auth, logging, dedup | **middleware** | this RFC (in-box) |
| outbound flow control (backpressure) | middleware, but needs a core seam | this RFC, §6.4: a design fork, not in the first in-box set |
| compression, signing/encryption, metrics/tracing | middleware, but app- or stack-specific config | shipped as **authoring examples**, not in-box (tracing becomes a future `durablews/otel` pack, RFC 0001 §9) |
| socket.io wire format | a **codec** | `durablews/socketio`, its own track |
| channels / actions / messages, incl. per-topic state cache | a **plugin** (adds API) | RFC 0003 |
| message acks, sequence-gap/replay | plugin-adjacent (add API or need the server) | with/after RFC 0003 |
| AsyncAPI typed-client generation | **tooling/codegen** | its own track |

The recurring trap is **cache**. There is no coherent cache for an
undifferentiated message stream: no key, no "result." Caching needs a
key, and *channels supply one* (the topic), which is why the per-topic
state cache lives in RFC 0003, not here. The HTTP sibling is where a
TanStack-Query-style response cache genuinely belongs.

## 4. The authoring contract

Everything in this section already exists and is exported from the package
root as of 2.0. This RFC's job is to **declare it stable** (the surface
we commit not to break) and to document the conventions around it.

### 4.1 The middleware shape

A middleware is a function `(ctx, next) => void | Promise<void>`. Direction
is set by **registration**, not by the function:

```ts
client.use((ctx, next) => { /* … */ });        // bare fn = inbound
client.use({ outbound });                       // outbound only
client.use({ inbound, outbound });              // one logical middleware,
                                                // both directions
```

(Keys are the full words, not `{ in, out }`: `in` is a reserved word,
illegal as a destructuring binding, which would force `{ in: inbound }`
renames, and the names match the exported type vocabulary. The Express
`req`/`res` brevity applies to callback *parameters*, which here are
already terse: `ctx`, `next`.)

- **Inbound** (`Middleware<TIn>`) runs per inbound message, in registration
  order, *after* `codec.decode` and schema validation, so middleware only
  ever sees decoded, valid data. `ctx.data` is the message (reassign to
  transform); `ctx.client` is the client (e.g. to auto-reply).
- **Outbound** (`OutboundMiddleware<TOut>`) runs per outgoing message at
  **transmission time** (after dequeue, before `codec.encode`). `ctx.data`
  is exactly what was passed to `send()`.

### 4.2 The stable guarantees

These are the semantics a middleware author may rely on and we will not
silently change:

1. **Order.** Middleware run in registration order. The outbound path is
   serialized: even when one middleware awaits, messages reach the socket
   in `send()` order (head-of-line by design: a delaying middleware delays
   everything behind it). When nothing awaits, the outbound path is fully
   synchronous (zero overhead).
2. **Short-circuit.** Returning without calling `next()` stops the chain:
   inbound, the message is not dispatched; outbound, it is **not sent, and
   no `drop` event fires** (`drop` means durability loss, not policy).
3. **Per-message error isolation.** A throw/rejection surfaces as an
   `error` event and skips only that message; later messages continue.
4. **Heartbeat bypass.** `pingpong` and heartbeat frames bypass outbound
   middleware entirely (transport liveness is not an app message).
5. **Transformation is by reassignment.** `ctx.data = …` is how you
   transform; the queue and `drop` events always carry the *original*
   un-transformed value.

### 4.3 Exported contract types

```ts
import type {
  Middleware,             // inbound: (ctx: MessageContext<TIn>, next) => …
  OutboundMiddleware,     // outbound: (ctx: OutboundContext<TOut>, next) => …
  DirectionalMiddleware,  // { inbound?, outbound? }
  MessageContext,         // { data: TIn; client }
  OutboundContext,        // { data: TOut; client }
} from "durablews";
```

### 4.4 The factory convention

Configurable middleware are **factories** returning a
`DirectionalMiddleware`, uniformly, including single-direction ones, so
every middleware registers the same way:

```ts
client.use(auth({ token, attach }));   // outbound-only → { outbound }
client.use(logger());                  // both → { inbound, outbound }
client.use(dedup({ key }));            // inbound-only → { inbound }
```

Returning `DirectionalMiddleware` (never a bare function) keeps the call
site uniform and lets a middleware grow a second direction later without a
breaking signature change.

### 4.5 Third-party packaging

Community middleware follow the existing ecosystem convention
(CONTRIBUTING.md): published as `durablews-plugin-<name>`, typed against
the exported contract. (Open question §8: whether middleware should get a
distinct `durablews-middleware-<name>` prefix, or keep the single
ecosystem namespace.)

## 5. Packaging & tree-shaking

The pack ships as a **subpath**: `durablews/middleware`, named exports,
**no module-level side effects**. The package already declares
`"sideEffects": false`, which is the contract that lets Rollup/Vite/esbuild
drop unreferenced exports, so `import { logger } from "durablews/middleware"`
pulls in *zero bytes* of `auth`, `dedup`, etc.

This is the answer to "won't bundling more middleware bloat apps?" The
point: **install size and bundle size are different problems.** Everything
is installed (the deliberate one-package choice, RFC 0001 §5); tree-shaking
guarantees unused middleware never reach the *bundle*.

**Enforced, not trusted.** CI gains one `size-limit` entry per export, each
importing a single middleware with a budget tight enough that a sibling
leaking in fails the build, the same per-entry mechanism already guarding
core/vue/react/compat.

## 6. The in-box set

Three middleware, each a factory (§4.4); config shapes are illustrative,
to be finalized in implementation. §6.4 covers outbound flow control,
which review moved *out* of the first in-box set.

### 6.1 `auth` (outbound)

```ts
auth({
  token: () => string | Promise<string>,   // resolved at transmission time
  attach: (data, token) => unknown,         // how to place it on the message
})
```

Calls `token()` when the message actually goes out, so a message queued
across a reconnect carries a **fresh** token. `attach` is required:
messages are app-shaped, there is no universal placement. Honestly this
middleware is *thin*: the hard part (transmission-time timing, ordered
async) is core; `auth` is the correct, tested glue over it. That it can be
thin is the point.

### 6.2 `logger` (inbound + outbound)

```ts
logger({
  log?: (entry) => void,          // default: console.debug
  redact?: (data) => unknown,     // scrub secrets/PII before logging
  direction?: "inbound" | "outbound" | "both",   // default "both"
})
```

Structured per-message entries (direction, data, timestamp, connection
state). **Redaction is the production-grade part** toy loggers skip: you
do not want auth tokens or PII in logs. Never mutates `ctx.data`.

### 6.3 `dedup` (inbound)

```ts
dedup({ key: (data) => string, window?: number })        // inbound
```

Drops inbound messages whose key was seen within a **bounded** window
(count, drop-oldest, never unbounded memory), so a server that redelivers
never reaches a handler twice. Needs a `key` extractor because messages
have no built-in id.

**Correction (implementation, 2026-06-16): `idempotency` is not shipped.**
The earlier draft paired `dedup` with an outbound `idempotency` member that
stamped a key "to make the at-least-once queue-flush safe." Implementation
review showed that premise does not hold for DurableWS: `client.ts` calls
`socket.send()` **at most once per message** (the mid-pipeline requeue only
puts back messages that were *not yet sent*), so the queue never produces
the duplicate such a key would dedup. The one edge case, the socket
accepting bytes that never reach the wire before a drop, is a *loss*, not a
duplicate, so the flush is effectively **at-most-once**. Worse, an outbound
key middleware re-runs on requeue (by design, to keep auth tokens fresh),
so a random-per-transmission key would *change* on retry, the opposite of
idempotent. The legitimate use, a Stripe-style key for the **server's own**
at-least-once processing, needs a *stable* key (content-derived or
app-supplied) and is a one-line outbound transform, so per the
"don't ship the too-granular piece" balance it stays a documented recipe,
not a canned member. True at-least-once *delivery* (track-and-resend) is a
core/channels concern, not middleware (RFC 0003 territory).

### 6.4 Outbound flow control (open, not committed in-box)

The fourth slot was `rateLimit`, but it conflated three mechanisms, only
one of which is a universal production concern:

- **Rate limiting** (token bucket, messages/interval): matters only when
  the *server* enforces a rate and drops offenders. Niche.
- **Concurrency semaphore** (bound in-flight count): on a fire-and-forget
  socket there is no per-message completion to count down on, so a
  semaphore only has meaning with **acks** (→ RFC 0003); without them it
  collapses into backpressure.
- **Backpressure** (gate on `bufferedAmount`): stop feeding the socket when
  its send buffer backs up faster than the network drains. *This* is the
  real one: it bounds client memory and latency, and it is the
  **open-socket counterpart to the disconnected queue** (bounded,
  drop-oldest) DurableWS already ships. Today the open-socket side is
  unmanaged.

All three are order-preserving, so §9 permits them as middleware, but
backpressure needs a seam core does not expose yet: `bufferedAmount` exists
only as a compat stub. So this is a design fork (§8), not a drop-in
middleware, and the first in-box release is the **three** above.

## 7. Inclusion & exclusion rationale

**In:** universal, mechanical, easy to get subtly wrong, and exercised by
the reconnect boundary that is DurableWS's whole reason to exist (auth,
dedup) or by every app regardless (logger). **Out (to
examples):** compression (`CompressionStream`) and signing/encryption
(WebCrypto) are §9-grounded but niche and app-specific; **metrics/tracing**
is high-value but blocked on the lack of stable WebSocket OTel semantic
conventions, so it becomes the `durablews/otel` pack on demand, not an
invented-attributes middleware shipped today. **Out (to other
categories):** cache, channels, codecs, AsyncAPI (§3).

## 8. Open questions

- **Outbound validation.** Inbound validation is core (`config.schema`,
  decode → schema → middleware). Should validating what you `send()` be a
  symmetric core option, or just the simplest outbound middleware
  (`validate({ schema })`)? Recommendation: **middleware first**, since it
  needs no core change and proves the pattern; promote to a core option
  only on demand. (This is the M5 "outbound validation" roadmap item.)
- **Outbound flow control (§6.4).** The real concern is *backpressure*
  (gate on `bufferedAmount`), not clock-based rate limiting or a
  concurrency semaphore (which needs acks). Fork: expose `bufferedAmount`
  as a small core seam and ship backpressure as middleware on top, or make
  it first-class core, symmetric with the disconnected queue? Out of the
  first in-box set either way.
- **Naming.** `Middleware` (inbound) vs `OutboundMiddleware` is an
  asymmetric pair; add an `InboundMiddleware` alias for symmetry? And do
  third-party middleware keep `durablews-plugin-*` or get
  `durablews-middleware-*` (§4.5)?
- **Subpath surface.** One `durablews/middleware` entry with all named
  exports (relies on tree-shaking), vs per-middleware subpaths. Default:
  one entry, since `sideEffects:false` makes per-subpath unnecessary unless
  a middleware grows a heavy dependency (none should; core is zero-dep).
