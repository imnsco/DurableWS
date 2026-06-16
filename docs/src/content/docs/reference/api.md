---
title: API reference
description: Every export of durablews, durablews/vue, and durablews/react.
---

## `defineClient(config)`

Creates a new client. Every call returns an independent instance, there is no
shared singleton.

```ts
import { defineClient } from "durablews";

const client = defineClient({ url: "wss://example.com/socket" });
```

Typing, three ways: pass a `schema` (types inferred + runtime validation),
pass generics (`defineClient<Incoming, Outgoing>(config)`), or neither
(messages are `unknown`).

### Config

| Option | Type | Default | |
| --- | --- | --- | --- |
| `url` | `string \| URL` |, | required |
| `protocols` | `string \| string[]` |, | passed to the underlying `WebSocket` |
| `codec` | `Codec` | `jsonCodec` | [the wire seam](/guides/codecs/) |
| `reconnect` | `false \| ReconnectOptions` | on | [durability tuning](/guides/durability/#reconnection) |
| `queue` | `false \| QueueOptions` | on, `maxSize: 256` | [queueing](/guides/durability/#queueing) |
| `heartbeat` | `HeartbeatOptions` | off | [heartbeat](/guides/durability/#heartbeat) |
| `schema` | `StandardSchemaV1` |, | [typed messages](/getting-started/#typed-and-validated-messages) |

## The client

| Member | Signature | Notes |
| --- | --- | --- |
| `state` | `ConnectionState` | live getter: `idle \| connecting \| open \| closing \| reconnecting \| closed` |
| `connect()` | `() => Promise<void>` | resolves on first open (incl. a successful retry); idempotent; rejects only on terminal failure, [details](/guides/durability/#connect-under-unlimited-retries) |
| `send(data)` | `(data: TOut) => void` | queues while `connecting`/`reconnecting`; throws in `idle`/`closing`/`closed` |
| `close(code?, reason?)` | | never triggers reconnection |
| `on(event, handler)` | returns unsubscribe | typed per event (below) |
| `use(middleware)` | returns the client | bare function = inbound; `{ inbound?, outbound? }` = per direction, [middleware](/guides/middleware/) |
| `getState()` | `() => ClientState` | frozen `{ state, lastError, retryAttempt, queueLength }`; referentially stable between changes |
| `subscribe(listener)` | returns unsubscribe | fires on **any** snapshot change |

### Events

| Event | Payload | Fires when |
| --- | --- | --- |
| `open` |, | the socket opened (after the queue flushed) |
| `message` | `TIn` | a message was decoded and (if configured) validated |
| `close` | `CloseEvent` | the socket closed, clean or not |
| `error` | `Event \| Error` | transport error, middleware throw, schema failure (`SchemaValidationError`), heartbeat timeout |
| `statechange` | `{ previous, current }` | the FSM transitioned |
| `reconnecting` | `{ attempt, delay }` | a retry was scheduled (once per attempt) |
| `drop` | `{ data: TOut, reason: "overflow" \| "close" }` | a queued message will never be sent |

## Other exports

| Export | What it is |
| --- | --- |
| `jsonCodec` | the default codec (JSON with binary passthrough) |
| `pingpong` | opt-in inbound middleware: auto-replies to `"ping"` with `"pong"`, without emitting `message` |
| `RECONNECT_DEFAULTS` / `QUEUE_DEFAULTS` | the resolved default option values |
| `HEARTBEAT_TIMEOUT_CODE` | `4408`, the close code a heartbeat timeout uses (filter it in `shouldReconnect`) |
| `SchemaValidationError` | the `error` payload for invalid inbound messages; carries the schema's `issues` |

All public types are exported: `WebSocketClient`, `WebSocketClientConfig`,
`Codec`, `ConnectionState`, `ClientState`, `ClientEventMap`, `Middleware`,
`MessageContext`, `OutboundMiddleware`, `OutboundContext`,
`DirectionalMiddleware`, `ReconnectOptions`, `QueueOptions`,
`HeartbeatOptions`, `DropEvent`, `ReconnectingEvent`, `StateChange`,
`StandardSchemaV1`.

## Subpath exports

| Subpath | Export | |
| --- | --- | --- |
| `durablews/vue` | `useWebSocket` composable | [Vue guide](/frameworks/vue/), optional peer `vue >= 3.2` |
| `durablews/react` | `useWebSocket` hook | [React guide](/frameworks/react/), optional peer `react >= 18` |

Installing `durablews` without the frameworks never warns; framework code
loads only via its subpath.
