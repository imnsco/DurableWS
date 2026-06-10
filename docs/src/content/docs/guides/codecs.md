---
title: Codecs
description: The wire-format seam — JSON by default, swap in anything.
---

Every message crosses `encode`/`decode`, so the wire format is a first-class
config option — not middleware:

```ts
interface Codec {
    encode(data: unknown): string | BufferSource | Blob;
    decode(data: unknown): unknown;
}
```

`encode`'s return type deliberately mirrors `WebSocket.send`'s parameter, so
the codec contract can never drift looser than what the socket accepts.

## The default: JSON

With no `codec` configured, `jsonCodec` applies:

- **encode** — strings pass through as-is; binary (`ArrayBuffer`,
  `ArrayBufferView`, `Blob`) passes through untouched; everything else is
  `JSON.stringify`-ed.
- **decode** — strings are `JSON.parse`-d with a safe fallback to the raw
  string when they aren't JSON; binary frames pass through untouched.

That means `client.send({ type: "hello" })` and `client.send(bytes)` both do
the right thing with zero setup.

## A custom codec

```ts
import { decode, encode } from "@msgpack/msgpack";
import { defineClient, type Codec } from "durablews";

const msgpackCodec: Codec = {
    encode: (data) => encode(data),
    decode: (data) =>
        data instanceof ArrayBuffer ? decode(new Uint8Array(data)) : data
};

const client = defineClient({ url, codec: msgpackCodec });
```

:::tip[Binary frames arrive as `Blob` in browsers]
Browsers deliver binary WebSocket frames as `Blob` by default. If your codec
expects `ArrayBuffer`, handle both — or decode the `Blob` asynchronously in an
inbound middleware instead, since `decode` is synchronous.
:::

## Where the codec sits

```
inbound:   frame → codec.decode → schema validation → middleware → message
outbound:  send() → [queue] → outbound middleware → codec.encode → socket
```

Two consequences worth knowing:

- [Schema validation](/getting-started/#typed-and-validated-messages) runs on
  *decoded* values — your schema describes application messages, not wire
  bytes.
- Outbound middleware runs *before* encode, so middleware transforms plain
  values and the codec owns serialization. A token-stamping middleware and a
  msgpack codec compose without knowing about each other.
