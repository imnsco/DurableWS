---
title: Vue
description: The useWebSocket composable — reactive DurableWS state for Vue 3.
---

DurableWS ships a first-class Vue 3 composable in the box: `durablews/vue`.
No extra package — Vue is an *optional* peer dependency, so installing
`durablews` without Vue never warns, and the composable only loads when you
import it.

```bash
npm install durablews
```

## Quick start

Pass a config and the composable owns the client: it connects immediately and
closes the connection when the component is unmounted.

```vue
<script setup lang="ts">
import { useWebSocket } from "durablews/vue";

const { state, lastMessage, send } = useWebSocket({
    url: "wss://example.com/socket"
});
</script>

<template>
    <p>Connection: {{ state }}</p>
    <p>Last message: {{ lastMessage }}</p>
    <button @click="send({ type: 'hello' })">Say hello</button>
</template>
```

Everything durable-by-default applies: the connection reconnects with
full-jitter backoff, `send()` queues while disconnected and flushes on open,
and `state` walks through `reconnecting` so your UI can show it.

## What you get back

| Property | Type | What it is |
| --- | --- | --- |
| `state` | `ComputedRef<ConnectionState>` | `idle → connecting → open → reconnecting → …` |
| `lastMessage` | `ShallowRef<TIn \| undefined>` | The latest decoded (and validated) inbound message |
| `lastError` | `ComputedRef<Event \| Error \| null>` | The most recent failure, if any |
| `retryAttempt` | `ComputedRef<number>` | Retries used in the current disconnection episode |
| `queueLength` | `ComputedRef<number>` | Outbound messages waiting for an open socket |
| `send` / `connect` / `close` | functions | Proxies to the client |
| `client` | `WebSocketClient` | The full client, for everything else (`on()`, `use()`, …) |

`lastMessage` keeps only the latest message — DurableWS never accumulates
message history. To process every message, handle the event on the client:

```ts
const { client } = useWebSocket({ url });
client.on("message", (msg) => {
    // every message, not just the latest
});
```

## Typed messages

Pass a [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …)
and `lastMessage` is fully typed — plus every inbound message is validated at
runtime:

```vue
<script setup lang="ts">
import { useWebSocket } from "durablews/vue";
import { z } from "zod";

const Message = z.object({ type: z.string(), body: z.string() });

const { lastMessage } = useWebSocket({
    url: "wss://example.com/socket",
    schema: Message
});
// lastMessage: ShallowRef<{ type: string; body: string } | undefined>
</script>
```

## Sharing one connection across components

Pass an **existing client** instead of a config and the composable only
observes it — it never connects or closes a client it was handed. This is the
pattern for an app-wide connection used by many components:

```ts
// src/ws.ts — the app owns this client
import { defineClient } from "durablews";

export const ws = defineClient({ url: "wss://example.com/socket" });
ws.connect();
```

```vue
<script setup lang="ts">
import { useWebSocket } from "durablews/vue";
import { ws } from "@/ws";

// Reactive views over the shared connection; unmounting this
// component does not close it.
const { state, lastMessage } = useWebSocket(ws);
</script>
```

## SSR (Nuxt)

The composable is SSR-safe: when no global `WebSocket` exists (the server
render), auto-connect is skipped and the client connects when setup runs again
in the browser.
