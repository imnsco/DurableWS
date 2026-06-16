# Collab notepad, the one-line migration

A collaborative notepad written against the **standard `WebSocket` API**, made
durable by swapping a single import:

```ts
import { WebSocket } from "durablews/compat";
```

```bash
pnpm install && pnpm -F durablews build   # once, from the repo root
pnpm -F example-collab-notepad dev        # server + Vite (one command)
```

Open the printed URL **twice**, side by side. Type in one window, watch the
other. Then the durability demo: **kill the server (`Ctrl-C`), keep typing,
restart it**: both windows walk through `reconnecting`, your buffered update
flushes, and the documents converge. With the native `WebSocket`, the same app
is dead at the first blip.

The sync itself is deliberately demo-grade (last-write-wins full-text), the
point is the transport, not CRDTs.

## Why not y-websocket/Yjs injection?

We tried, and it taught us the layering rule now documented in the
[compat guide](https://durablews.imns.co/guides/compat/): libraries with
**stateful sync protocols** (y-websocket, graphql-ws) implement their *own*
reconnection because they must re-handshake per connection. Injecting a
self-reconnecting socket under them creates two reconnect layers fighting
each other. Compat's sweet spot is code that treats the socket as a plain
pipe, like this app, and like most hand-rolled WebSocket code.
