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

- Connect / send / close over the standard `WebSocket`, driven by an explicit
  connection state machine
- Incoming-message handling and lifecycle events (`open`, `message`, `close`,
  `error`, `statechange`) via `on()`
- A read-only `state` and `getState()` snapshot
- A pluggable wire-format codec (`codec` option; JSON by default)

## On the roadmap

A middleware pipeline, automatic reconnection with exponential backoff, message
queueing while disconnected, idle detection, and channels. Until these land,
treat the durability features as a roadmap rather than a guarantee — see the
[architecture RFC](https://github.com/imnsco/DurableWS/blob/main/rfcs/0001-v2-architecture.md)
for the full plan and status.
