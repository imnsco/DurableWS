# DurableWS 2.0 — a WebSocket client that survives the real world

> **DRAFT** — for review before publishing (blog / dev.to / HN / r/javascript).
> Publish alongside the 2.0.0 npm release.

Every WebSocket app eventually grows the same five hundred lines: a reconnect
loop with a `setTimeout` someone tuned at 2 a.m., a hand-rolled message buffer
that's either unbounded or silently lossy, a `JSON.parse` wrapped in a `try`
that swallows everything, and a `readyState` check copy-pasted into every
component. We wrote those lines too many times, looked at what existed, and
built DurableWS 2.0 instead.

**The pitch in one paragraph:** a zero-dependency TypeScript WebSocket client,
built on the standard global `WebSocket` (browsers, Node ≥ 22, Deno, Bun,
edge — all four runtimes in CI, not a claims list), durable by default:
reconnection and queueing are on with zero config, every message can be typed
*and* runtime-validated, and the core is **2.4 KB** brotli with a CI-enforced
budget.

```bash
npm install durablews
```

```ts
import { defineClient } from "durablews";
import { z } from "zod";

const Message = z.object({ type: z.string(), body: z.string() });
const client = defineClient({ url: "wss://example.com", schema: Message });

client.on("message", (msg) => {
    // msg: { type: string; body: string } — inferred AND validated
});
await client.connect();
client.send({ type: "hello", body: "world" }); // queues if not open yet
```

## We fixed reconnection properly

Reconnection is where most implementations are quietly wrong, so we treated it
as the design center, not a feature checkbox:

- **An explicit state machine.** `idle → connecting → open → reconnecting →
  …` with a transition table — an illegal transition is *unrepresentable*,
  not a silent no-op. Your UI can `subscribe()` to the whole snapshot
  (state, retry attempt, queue length, last error) with referentially-stable
  reads — it's exactly the `useSyncExternalStore` contract.
- **Full-jitter exponential backoff.** Delay drawn uniformly from
  `[0, min(cap, base·2ⁿ)]` — when your deploy drops ten thousand clients at
  once, they don't come back as a synchronized battering ram.
- **A promise that tells the truth.** `connect()` resolves on first open —
  including when that open is a successful retry — and rejects only on
  *terminal* failure. Under the default unlimited retries it never lies to
  you by rejecting while the client is still working.
- **Bounded, observable queueing.** `send()` while disconnected queues
  (drop-oldest, 256 by default) and flushes in order on open. Every message
  that will never be sent fires a `drop` event with the exact value you
  passed. An unbounded silent buffer is a memory leak with a delay; a capped
  silent one is data loss with no witness. We refuse both.
- **Heartbeat for the worst failure mode** — the connection that's open but
  dead. Opt-in ping with any-inbound-counts liveness; a silent link is
  closed (code `4408`) and recovered through the same machinery.

## The parts around the socket

- **Middleware, both directions.** An onion pipeline (Hono/Koa style). The
  outbound side runs at *transmission* time — a message queued across a
  30-second reconnect goes out with a token that's fresh *now* — and async
  middleware preserves strict send order.
- **Typed messages via [Standard Schema](https://standardschema.dev).** Bring
  zod, valibot, arktype — types inferred, every inbound frame validated
  before your handlers see it. Still zero dependencies.
- **Vue and React bindings in the box.** `durablews/vue` (composable) and
  `durablews/react` (hook) as subpath exports with optional peers.
- **A drop-in `WebSocket` class.** `durablews/compat` for one-line migration
  of existing code — with a published [known-deviations
  table](https://durablews.imns.co/guides/compat/) instead of a pretense of
  spec perfection.

## What we won't claim

The incumbents deserve honest treatment:
[reconnecting-websocket](https://github.com/pladaria/reconnecting-websocket)
defined this category and partysocket maintains its lineage well — both buffer
messages, both reconnect, and partysocket does some things we don't yet
(dynamic URL providers). Our full comparison — including a "what the
alternatives do better" section — is [on the docs
site](https://durablews.imns.co/comparison/). And 2.0 is new code: the test
pyramid is real (unit, integration, real-browser Playwright, plus Node, Deno,
and Bun e2e in CI), but production miles are earned, not claimed.

One lesson from building the examples that's worth stealing even if you never
use DurableWS: **one reconnector per stack.** Libraries with stateful sync
protocols (y-websocket, graphql-ws) run their own reconnection because they
must re-handshake per connection — injecting a self-reconnecting socket under
them creates two recovery layers fighting each other. Durability belongs at
exactly one layer; pick it deliberately.

## Try it

- **Docs:** [durablews.imns.co](https://durablews.imns.co) — guides for
  durability tuning, middleware, codecs, and the framework bindings.
- **The playground:** clone the repo and run the
  [resilience playground](https://github.com/imnsco/DurableWS/tree/main/examples/resilience-playground)
  — a server you sabotage from the UI while the client refuses to die.
- **Source:** [github.com/imnsco/DurableWS](https://github.com/imnsco/DurableWS) (MPL-2.0).

Feedback, bug reports, and middleware/codec contributions welcome — the
[contributing guide](https://github.com/imnsco/DurableWS/blob/main/CONTRIBUTING.md)
has the plugin naming conventions and the changesets workflow.
