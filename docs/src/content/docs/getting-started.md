---
title: Getting started
description: Install DurableWS and open your first connection.
---

:::caution[Alpha]
v2 (`2.0.0-alpha`) is in active development. The current npm release (`1.x`)
predates this redesign, and the durability features below are still being
built — track progress in the
[architecture RFC](https://github.com/imnsco/DurableWS/blob/main/rfcs/0001-v2-architecture.md).
:::

## Requirements

DurableWS targets the standard global `WebSocket` with **zero runtime
dependencies**:

- **Node.js ≥ 22** — the first release with the global `WebSocket` available
  unflagged (there is no `ws` dependency, by design).
- Any modern runtime with a global `WebSocket`: current browsers, Deno, Bun,
  and Cloudflare Workers.

## Installation

```bash
npm install durablews@alpha
```

## Quick start

```ts
import { defineClient } from "durablews";

const client = defineClient({ url: "wss://example.com/socket" });

client.on("message", (data) => {
    console.log("received:", data);
});

await client.connect();
client.send({ type: "hello", message: "world" });

// later
client.close();
```

## Typed (and validated) messages

Pass any [Standard Schema](https://standardschema.dev) — zod, valibot,
arktype, … — and you get **both** static types and runtime validation, with
zero added dependencies:

```ts
import { z } from "zod";
import { defineClient } from "durablews";

const Message = z.object({ type: z.string(), body: z.string() });

const client = defineClient({
    url: "wss://example.com/socket",
    schema: Message
});

client.on("message", (msg) => {
    // msg is { type: string; body: string } — inferred from the schema,
    // and every inbound message was validated at runtime.
});

client.on("error", (err) => {
    // Invalid inbound messages arrive here as SchemaValidationError
    // (with the schema's issues) instead of reaching your handler.
});
```

Validation runs after the codec decodes and **before** middleware, so
middleware and handlers only ever see trusted data.

Prefer types without runtime checks? Use generics:

```ts
const client = defineClient<Incoming, Outgoing>({ url });
// on("message") receives Incoming; send() accepts Outgoing
```

## Middleware

Middleware intercepts messages on their way through the client — in both
directions. A bare function is **inbound** middleware; the object form
registers per direction:

```ts
client.use({
    outbound: async (ctx, next) => {
        // Attach a token that is fresh when the message actually goes out —
        // outbound middleware runs at transmission time, so even a message
        // queued across a reconnect gets a current token.
        ctx.data = { ...ctx.data, token: await getFreshToken() };
        await next();
    }
});
```

Outbound middleware may be async: the outbound path preserves `send()` order,
so messages never overtake each other (which also means a slow middleware
delays everything behind it — pacing the stream is a feature, but per-key
debounce/batching belongs in a wrapper *in front of* `send()`, not in the
pipeline). Returning without calling `next()` deliberately drops the message —
no `drop` event, that's policy, not loss. A throw fails only that message (it
surfaces as an `error` event) and later messages continue. Heartbeat pings
bypass outbound middleware entirely.

## What works today

- **Automatic reconnection, on by default** — full-jitter exponential backoff
  with unlimited retries. An unexpected disconnect transparently recovers; a
  `reconnecting` event (`{ attempt, delay }`) keeps your UI informed. Tune or
  disable via the `reconnect` option (`baseDelay`, `factor`, `maxDelay`,
  `jitter`, `maxRetries`, `shouldReconnect`, or `reconnect: false`).
- **Message queueing while disconnected, on by default** — `send()` during
  `connecting`/`reconnecting` queues (bounded, 256 by default) and flushes in
  order when the socket opens. Dropped messages are never silent: every one
  fires a `drop` event (`{ data, reason }`). Tune via `queue: { maxSize }` or
  restore throw-when-not-open with `queue: false`.
- **Heartbeat / idle detection, opt-in** — set
  `heartbeat: { interval, message?, timeout? }` and the client pings while
  open; if no inbound traffic answers within `timeout`, the link is declared
  dead (close code `4408`) and the normal reconnect machinery takes over.
  Opt-in because it requires a server that answers the ping.
- Connect / send / close over the standard `WebSocket`, driven by an explicit
  connection state machine
- Incoming-message handling and lifecycle events (`open`, `message`, `close`,
  `error`, `statechange`, `reconnecting`, `drop`) via `on()`
- A read-only `state` and `getState()` snapshot (incl. `retryAttempt` and
  `queueLength`)
- A pluggable wire-format codec (`codec` option; JSON by default)
- **Typed + validated messages** via any Standard Schema (`schema` option),
  or plain generics (`defineClient<In, Out>`)
- A message middleware pipeline (`use()`) — **inbound and outbound**, with
  outbound running at transmission time, async-capable with strict
  `send()`-order preservation; plus an opt-in `pingpong` keepalive
- **Framework bindings in the box** — a [Vue composable](/frameworks/vue/) and
  a [React hook](/frameworks/react/) (`durablews/vue`, `durablews/react`) with
  reactive connection state and automatic cleanup; the frameworks are optional
  peers, so core installs never warn

:::note[`connect()` and unlimited retries]
`connect()` resolves on the first successful open — including when that open is
a successful retry. Under the default `maxRetries: Infinity` it never rejects:
against a down host it stays pending while the client keeps trying. That is the
durable-by-default contract. Need a deadline? Set a finite `maxRetries` or race
it: `Promise.race([client.connect(), timeout(10_000)])`.
:::

## On the roadmap

A drop-in `WebSocket`-compatible compat class, expanded guides and an API
reference, and channels — see the
[architecture RFC](https://github.com/imnsco/DurableWS/blob/main/rfcs/0001-v2-architecture.md)
for the full plan and status.
