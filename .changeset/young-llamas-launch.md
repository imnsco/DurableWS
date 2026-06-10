---
"durablews": minor
---

First public v2 alpha. A ground-up rewrite of the client around an explicit
connection state machine — durable by default, zero dependencies, built on the
standard global `WebSocket` (browsers, Node ≥ 22, Deno, Bun, edge).

- **Automatic reconnection, on by default** — full-jitter exponential backoff,
  unlimited retries, `shouldReconnect` veto, `reconnecting` events.
- **Message queueing while disconnected, on by default** — bounded,
  drop-oldest, flushed in order on open; every dropped message fires a `drop`
  event.
- **Opt-in heartbeat / idle detection** — dead links are closed (code `4408`)
  and recovered through the normal reconnect machinery.
- **Typed + validated messages** — pass any Standard Schema (zod, valibot,
  arktype, …) and message types are inferred and runtime-validated; or use
  plain generics.
- **Middleware, inbound and outbound** — `use()` onion pipeline; outbound runs
  at transmission time, async-capable with strict send-order preservation
  (auth/token-refresh ready).
- **Framework bindings in the box** — `durablews/vue` (composable) and
  `durablews/react` (hook via `useSyncExternalStore`), with the frameworks as
  optional peers.
- **Pluggable codec** — JSON by default, swap in anything.
- Promise-based `connect()`, standard event vocabulary (`open` / `message` /
  `close` / `error` / `statechange`), observable state snapshots with
  `subscribe()` / `getState()`.

Breaking: the v1 store API (`defineStore`, `dispatch`, actions/reducers) is
removed; `defineClient` no longer returns a shared singleton.
