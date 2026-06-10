---
title: Why DurableWS?
description: An honest comparison with reconnecting-websocket, partysocket, and socket.io.
---

The niche DurableWS lives in is *durable clients over the standard
`WebSocket`*. Two libraries already live there, and one giant defines the
category's expectations from outside it. Here's where we genuinely differ —
including the places the alternatives are ahead today.

## The landscape

- **[reconnecting-websocket](https://github.com/pladaria/reconnecting-websocket)** —
  the long-standing default for "a WebSocket that reconnects". Its last
  release was in 2020; dozens of issues and PRs sit open.
- **[partysocket](https://www.npmjs.com/package/partysocket)** — the
  actively-maintained fork (PartyKit / Cloudflare), with bugfixes, pending
  PRs, multi-platform support, and a React hook. If you want a maintained
  drop-in `WebSocket` class today, this is the one to beat — and the one we
  benchmark ourselves against.
- **socket.io** — a different category. Its gravity is server-side (rooms,
  namespaces, broadcast), its protocol requires a socket.io server, and its
  client can't talk to a plain WebSocket server. If you control the server
  and want rooms out of the box, use socket.io. If you have a plain
  WebSocket endpoint and need a client that survives the real world — that's
  this niche.

## Feature comparison

| | durablews | partysocket | reconnecting-websocket |
| --- | --- | --- | --- |
| Reconnection | ✅ exponential, **full jitter** | ✅ exponential | ✅ exponential |
| Queue while disconnected | ✅ **bounded**, drop-oldest | ✅ unbounded by default | ✅ unbounded by default |
| Observable drops | ✅ `drop` events, never silent | ❌ | ❌ |
| Promise-based `connect()` | ✅ resolves on open, terminal-failure rejection | ❌ event-based | ❌ event-based |
| Typed messages | ✅ generics + **Standard Schema** runtime validation | ❌ | ❌ |
| Middleware | ✅ inbound **and** outbound (auth, async-safe, ordered) | ❌ | ❌ |
| Pluggable codec | ✅ | ❌ | ❌ |
| Heartbeat / idle detection | ✅ opt-in, any-inbound-counts | ❌ | ❌ |
| Observable connection state | ✅ FSM + `subscribe()`/`getState()` snapshots | `readyState` | `readyState` |
| Framework bindings | ✅ Vue **and** React, in the box | React | ❌ |
| Drop-in `WebSocket` class | ✅ [`durablews/compat`](/guides/compat/) | ✅ | ✅ |
| Dynamic URL provider | ❌ (on the radar) | ✅ sync/async | ❌ |
| Zero dependencies | ✅ | ✅ | ✅ |
| Actively maintained | ✅ (alpha) | ✅ | last release 2020 |

## What the differences mean in practice

**Queueing you can reason about.** All three buffer messages while
disconnected. The difference is what happens at the edges: DurableWS's queue
is bounded (256 by default), drops the oldest when full, and **every** dropped
message — overflow or connection-death — fires a `drop` event carrying exactly
what you passed to `send()`. An unbounded silent buffer is a memory leak with
a delay; a capped silent buffer is data loss with no witness.

**Durability that composes.** Reconnecting is table stakes. The harder
problem is everything attached to it: the message queued across a reconnect
that should go out with a *fresh* auth token (outbound middleware runs at
transmission time), the quiet-but-dead link (heartbeat closes it with code
`4408` and lets the reconnect machinery recover), the UI that wants to show
`reconnecting (attempt 3)` (an explicit state machine you can subscribe to,
not a `readyState` integer).

**Types end to end.** Pass a [Standard Schema](https://standardschema.dev)
(zod, valibot, arktype, …) and inbound messages are typed *and*
runtime-validated before your handlers or middleware see them. The
alternatives hand you `MessageEvent["data"]`.

## What the alternatives do better today

Honesty over marketing:

- **Dynamic URL resolution.** partysocket accepts `url` as a sync or async
  function, re-resolved per reconnect — handy for token-in-URL auth schemes.
  DurableWS handles token freshness via outbound middleware, but per-connect
  URL re-resolution isn't built yet.
- **Years in production.** The reconnecting-websocket lineage has carried an
  enormous amount of traffic. DurableWS 2.0 is an alpha with a thorough test
  pyramid (unit, integration, real-browser e2e) — but production-miles are
  earned, not claimed.
