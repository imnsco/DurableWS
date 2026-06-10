---
title: React
description: The useWebSocket hook — DurableWS state in React, built on useSyncExternalStore.
---

DurableWS ships a first-class React hook in the box: `durablews/react`.
No extra package — React is an *optional* peer dependency, so installing
`durablews` without React never warns, and the hook only loads when you
import it. React 18+ is required.

```bash
npm install durablews@alpha
```

## Quick start

Pass a config and the hook owns the client: it connects on mount and closes
the connection on unmount.

```tsx
import { useWebSocket } from "durablews/react";

function Chat() {
    const { state, lastMessage, send } = useWebSocket({
        url: "wss://example.com/socket"
    });

    return (
        <div>
            <p>Connection: {state}</p>
            <p>Last message: {JSON.stringify(lastMessage)}</p>
            <button onClick={() => send({ type: "hello" })}>Say hello</button>
        </div>
    );
}
```

Everything durable-by-default applies: the connection reconnects with
full-jitter backoff, `send()` queues while disconnected and flushes on open,
and `state` walks through `"reconnecting"` so your UI can show it.

The hook is built on `useSyncExternalStore` — the client's `subscribe()` /
`getState()` pair is exactly that contract, with referentially stable
snapshots — so it is concurrent-rendering-safe and Strict Mode's double-effect
mount/unmount cycle is handled.

## What you get back

| Property | Type | What it is |
| --- | --- | --- |
| `state` | `ConnectionState` | `"idle" → "connecting" → "open" → "reconnecting" → …` |
| `lastMessage` | `TIn \| undefined` | The latest decoded (and validated) inbound message |
| `lastError` | `Event \| Error \| null` | The most recent failure, if any |
| `retryAttempt` | `number` | Retries used in the current disconnection episode |
| `queueLength` | `number` | Outbound messages waiting for an open socket |
| `send` / `connect` / `close` | functions | Proxies to the client |
| `client` | `WebSocketClient` | The full client, for everything else (`on()`, `use()`, …) |

`lastMessage` keeps only the latest message — DurableWS never accumulates
message history. To process every message, subscribe on the client in an
effect:

```tsx
const { client } = useWebSocket({ url });

useEffect(() => {
    // on() returns its own unsubscribe — ready-made effect cleanup.
    return client.on("message", (msg) => {
        // every message, not just the latest
    });
}, [client]);
```

## Typed messages

Pass a [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …)
and `lastMessage` is fully typed — plus every inbound message is validated at
runtime:

```tsx
import { useWebSocket } from "durablews/react";
import { z } from "zod";

const Message = z.object({ type: z.string(), body: z.string() });

function Chat() {
    const { lastMessage } = useWebSocket({
        url: "wss://example.com/socket",
        schema: Message
    });
    // lastMessage: { type: string; body: string } | undefined
}
```

The config is captured on first render — changing it later does not recreate
the client, so an inline config object is fine (no `useMemo` needed).

## Sharing one connection across components

Pass an **existing client** instead of a config and the hook only observes
it — it never connects or closes a client it was handed. This is the pattern
for an app-wide connection used by many components:

```tsx
// src/ws.ts — the app owns this client
import { defineClient } from "durablews";

export const ws = defineClient({ url: "wss://example.com/socket" });
ws.connect();
```

```tsx
import { useWebSocket } from "durablews/react";
import { ws } from "./ws";

function StatusBadge() {
    // Reactive views over the shared connection; unmounting this
    // component does not close it.
    const { state } = useWebSocket(ws);
    return <span>{state}</span>;
}
```

## SSR (Next.js, Remix)

The hook is SSR-safe out of the box: connecting happens in an effect, and
effects don't run on the server. The server render sees the client's initial
snapshot (`state: "idle"`).
