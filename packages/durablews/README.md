# DurableWS

> The WebSocket client that survives the real world — automatic reconnection,
> bounded queueing, and typed messages. Zero dependencies, every modern
> runtime, durable by default.

> ⚠️ **v2 is in alpha** (`npm install durablews@alpha`). The features below
> are built and tested (unit, integration, real-browser e2e); the API may
> still shift before 2.0. The
> [architecture RFC](https://github.com/imnsco/DurableWS/blob/main/rfcs/0001-v2-architecture.md)
> tracks design and status. The `1.x` release predates this rewrite — don't
> use it.

## What you get

- **Automatic reconnection, on by default** — full-jitter exponential
  backoff, unlimited retries, a `shouldReconnect` veto, and `reconnecting`
  events for your UI.
- **Message queueing while disconnected, on by default** — bounded,
  drop-oldest, flushed in order on open. Every dropped message fires a `drop`
  event; nothing is silently lost.
- **Opt-in heartbeat / idle detection** — quietly-dead links are closed (code
  `4408`) and recovered through the normal reconnect machinery.
- **Typed + validated messages** — pass any
  [Standard Schema](https://standardschema.dev) (zod, valibot, arktype, …)
  and inbound messages are type-inferred *and* runtime-validated.
- **Middleware, inbound and outbound** — an onion pipeline with async-safe,
  ordered outbound execution (auth/token-refresh ready).
- **Pluggable codec** — JSON by default; swap in msgpack or anything else.
- **Vue & React bindings in the box** — `durablews/vue` (composable) and
  `durablews/react` (hook); the frameworks are optional peers.
- **A drop-in `WebSocket` class** — `durablews/compat` for one-line migration
  or `webSocketImpl` injection, with a published known-deviations table.
- **Zero runtime dependencies**, built on the standard global `WebSocket`.

## Requirements

- **Node.js ≥ 22** — the first release where the global `WebSocket` is
  available unflagged. (There is no `ws` dependency, by design.)
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

Typed and validated, with any Standard Schema:

```ts
import { z } from "zod";

const Message = z.object({ type: z.string(), body: z.string() });
const client = defineClient({ url, schema: Message });

client.on("message", (msg) => {
    // msg: { type: string; body: string } — validated at runtime
});
```

## Documentation

**[durablews.imns.co](https://durablews.imns.co)** — getting started, guides
(durability tuning, middleware, codecs, drop-in compat), framework pages, the
API reference, and an honest comparison with the alternatives.

## Contributing

Contributions are welcome — see [CONTRIBUTING](https://github.com/imnsco/DurableWS/blob/main/CONTRIBUTING.md).

## License

[MPL-2.0](./LICENSE) © Nate Smith
