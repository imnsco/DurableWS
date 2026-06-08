# DurableWS

> A resilient, modern, zero-dependency WebSocket **client** for TypeScript — built on the standard `WebSocket`, durable by default, and the same in every modern runtime.

> ⚠️ **v2 is under active development (`2.0.0-alpha`).** The API is changing and several headline features below are still being built. See the [v2 architecture RFC](https://github.com/imns/durablews/blob/main/docs/rfc/0001-v2-architecture.md) for the design and live status. The current npm release (`1.x`) predates this redesign.

DurableWS aims to be "the Hono of WebSockets": tiny, ergonomic, Web-Standards-based, and **durable by default** — automatic reconnection, message queueing, and idle detection out of the box — with a middleware + codec pipeline for extensibility (custom wire formats, auth, a socket.io-compatibility layer, and more).

## Status

DurableWS v2 is being built in the open. To be accurate about what exists today vs. what's planned:

**Working now**

- Connect / send / close and incoming-message handling over the standard `WebSocket`
- Event subscriptions (`on` / `off`)
- A middleware pipeline (`use`)
- Built-in JSON-safe message parsing and a ping/pong middleware

**Planned for v2 (not yet implemented)**

- Automatic reconnection with exponential backoff
- Message queueing while disconnected, flushed on reconnect
- Idle detection
- A typed connection state machine
- Pluggable codecs (msgpack, socket.io framing, …) and an authentication helper
- Channels / subscriptions

Until these land, treat the durability features as a roadmap, not a guarantee.

## Requirements

DurableWS targets the **standard global `WebSocket`** and ships **zero runtime dependencies**. That means:

- **Node.js ≥ 22** — the first release where the global `WebSocket` is available unflagged. (There is no `ws` dependency, by design.)
- Any modern runtime with a global `WebSocket`: current browsers, Deno, Bun, and Cloudflare Workers.

## Installation

```bash
# v2 is not yet published; once the alpha ships it will be:
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

## Documentation

- [v2 architecture RFC](https://github.com/imns/durablews/blob/main/docs/rfc/0001-v2-architecture.md)
- A full documentation site (Astro + Starlight) is coming as part of v2.

## Contributing

Contributions are welcome — see [CONTRIBUTING](https://github.com/imns/durablews/blob/main/CONTRIBUTING.md).

## License

[MPL-2.0](./LICENSE) © Nate Smith
