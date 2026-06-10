---
title: Migrating from v1
description: What changed between durablews 1.x and 2.0.
---

v2 is a ground-up rewrite. v1's README advertised durability features the code
didn't implement; v2 implements them. The API breaks — deliberately and once.

## The store is gone

v1 was a Redux-style store: `defineStore`, `dispatch`, `defineAction`,
`composeActions`, reducers over connection state. All of it is removed. The
connection lifecycle is now a typed finite state machine the library owns, and
**messages are never accumulated in state** (v1's default handler retained
every message forever — an unbounded leak).

```ts
// v1
const store = defineStore({ url });
store.dispatch("connect");

// v2
const client = defineClient({ url });
await client.connect();
```

If you used the store for app state: deliver messages into your own state
tool (a `message` handler that writes to your store of choice) — core stays
out of app state by design.

## No more singleton

v1's `defineClient` cached a module-level instance and silently ignored config
on the second call. v2 returns a **fresh client per call**; export your own
instance if you want a singleton:

```ts
// src/ws.ts
export const ws = defineClient({ url });
```

## Event names follow the WebSocket standard

| v1 | v2 |
| --- | --- |
| `connected` | `open` |
| `closed` (never fired — the v1 bug) | `close` |
| — | `statechange`, `reconnecting`, `drop` |

```ts
client.on("open", () => {});
client.on("message", (msg) => {});
client.on("close", (event) => {});
```

## send() semantics

v1's `send()` silently dropped messages when the socket wasn't open. v2
**queues** during `connecting`/`reconnecting` (bounded, drop-oldest, with
`drop` events) and **throws** in states where no open is coming. Nothing is
ever silently lost.

## What you get for the migration

Everything v1 promised, real this time: automatic reconnection with
full-jitter backoff, bounded message queueing, opt-in heartbeat, plus typed +
schema-validated messages, middleware in both directions, a pluggable codec,
and Vue/React bindings in the box. See [Getting started](/getting-started/).
