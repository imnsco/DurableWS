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
- A message middleware pipeline (`use()`), with an opt-in `pingpong` keepalive

:::note[`connect()` and unlimited retries]
`connect()` resolves on the first successful open — including when that open is
a successful retry. Under the default `maxRetries: Infinity` it never rejects:
against a down host it stays pending while the client keeps trying. That is the
durable-by-default contract. Need a deadline? Set a finite `maxRetries` or race
it: `Promise.race([client.connect(), timeout(10_000)])`.
:::

## On the roadmap

Framework bindings (React first), typed message maps, and channels — see the
[architecture RFC](https://github.com/imnsco/DurableWS/blob/main/rfcs/0001-v2-architecture.md)
for the full plan and status.
