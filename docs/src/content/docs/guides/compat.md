---
title: Drop-in compat
description: A WebSocket-shaped class over the durable core — durablews/compat.
---

`durablews/compat` exports a class shaped like the native `WebSocket`, with
the durable core underneath: automatic reconnection with full-jitter backoff,
bounded queueing, opt-in heartbeat. It exists for two audiences:

1. **App code that constructs sockets directly** — the
   `reconnecting-websocket` / `partysocket` crowd. Migration is one line.
2. **Libraries with a `webSocketImpl`-style injection point** — graphql-ws,
   y-websocket, realtime SDKs. Inject durability into tools that never learn
   durablews exists.

```ts
import { WebSocket } from "durablews/compat";

const ws = new WebSocket("wss://example.com/socket");
ws.onmessage = (event) => console.log(event.data);
ws.send("hello");
```

The class is also exported as `DurableWebSocket` if you prefer not to shadow
the global name.

## Injection

```ts
// graphql-ws
import { createClient } from "graphql-ws";
import { WebSocket } from "durablews/compat";

const client = createClient({
    url: "wss://example.com/graphql",
    webSocketImpl: WebSocket
});
```

```ts
// y-websocket
import { WebsocketProvider } from "y-websocket";
import { WebSocket } from "durablews/compat";

const provider = new WebsocketProvider(url, room, doc, {
    WebSocketPolyfill: WebSocket
});
```

## Tuning the durability

The third constructor argument takes the durablews config (everything except
`codec` and `schema` — compat is deliberately wire-faithful, byte in, byte
out):

```ts
const ws = new WebSocket(url, undefined, {
    reconnect: { maxDelay: 10_000 },
    queue: { maxSize: 1000 },
    heartbeat: { interval: 15_000 }
});
```

And the full durablews client sits underneath as the escape hatch:

```ts
ws.client.on("reconnecting", ({ attempt }) => showBanner(attempt));
ws.client.on("drop", ({ data }) => log("not sent", data));
```

## Known deviations

A drop-in that quietly diverges is worse than one that tells you where. The
deviations, exhaustively:

| Behavior | Native `WebSocket` | `durablews/compat` |
| --- | --- | --- |
| `readyState` across disconnects | one-shot: never leaves `CLOSED` | returns to `CONNECTING` during automatic reconnects — the entire point |
| `send()` while `CONNECTING` | throws `InvalidStateError` | **queues**, flushes in order on open |
| `close` events | once, at the end | once per dropped connection (each followed by reconnection) |
| `protocol` / `extensions` | negotiated values | always `""` |
| `bufferedAmount` | bytes pending on the socket | always `0` |
| `binaryType` set *after* construction | reconfigures the socket | emulated: `Blob` frames are converted on delivery (order-preserving, one copy). Prefer `{ binaryType: "arraybuffer" }` in the options, which configures the socket itself |
| `send()` after `close()` | silently discarded | silently discarded (matched) |

If one of these deviations matters to your integration, use the primary
[`defineClient`](/reference/api/) API instead — it doesn't pretend to be a
one-shot socket, so none of these tensions exist there.
