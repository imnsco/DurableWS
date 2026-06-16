---
title: Middleware
description: Intercept messages in both directions, auth, logging, filtering, transforms.
---

Middleware intercepts messages flowing through the client. It follows the
onion model you know from Hono or Koa: each middleware receives a context and
a `next()`, may transform `ctx.data`, may short-circuit by not calling
`next()`, and may be async.

A bare function registers **inbound** middleware; the object form registers
per direction:

```ts
client.use((ctx, next) => { ... });                  // inbound
client.use({ outbound: attachToken });               // outbound only
client.use({ inbound: logIn, outbound: logOut });    // one logical middleware,
                                                     // both directions
```

Middleware never adds client API, that's the [vocabulary](/reference/api/)
boundary between middleware and plugins.

## Inbound

Runs after `codec.decode` (and after [schema validation](/getting-started/#typed-and-validated-messages),
so middleware only ever sees trusted data), before the `message` event:

```ts
client.use((ctx, next) => {
    console.log("received:", ctx.data);
    ctx.data = normalize(ctx.data); // handlers see the transformed value
    return next();
});
```

Short-circuiting suppresses the `message` event, useful for protocol frames
your handlers shouldn't see. The built-in `pingpong` middleware does exactly
this: auto-replies to server pings without bubbling them.

```ts
import { pingpong } from "durablews";
client.use(pingpong);
```

## Outbound

Runs at **transmission time**: after the queue, before `codec.encode`. The
flagship use case is auth:

```ts
client.use({
    outbound: async (ctx, next) => {
        ctx.data = { ...ctx.data, token: await getFreshToken() };
        await next();
    }
});
```

Transmission-time execution is a durability feature: a message queued across a
30-second reconnect is stamped with a token that is fresh *when it actually
goes out*, not when you called `send()`. It also means `drop` events always
carry the raw value you passed to `send()`, never a half-transformed one.

### Ordering (and its honest cost)

Outbound middleware may be async, and the outbound path is **serialized**:
messages reach the socket in `send()` order even while an earlier message's
middleware awaits. When nothing is in flight and the chain is synchronous,
`send()` stays fully synchronous, zero overhead.

The flip side: a middleware that delays one message delays everything behind
it (head-of-line). That's correct for the things middleware is for, pacing
the stream *means* delaying it; a token refresh blocking sends is what
freshness requires. Policies that want to selectively delay or collapse
*specific* messages (per-key debounce, batching) inherently want reordering,
which the pipeline refuses. Compose those in front of `send()` instead:

```ts
const sendTyping = debounce((s) => client.send(s), 300);
```

Same composability, different layer, and unrelated messages never wait.

### Failure semantics

- **Short-circuit** (returning without `next()`) means *deliberately not
  sent*. No `drop` event, `drop` means the library couldn't deliver
  something; this is your policy choosing not to.
- **A throw or rejection** surfaces as an `error` event and skips **only that
  message**; everything behind it continues.
- **Connection drops mid-pipeline** (an async middleware was awaiting when
  the socket died): if a reconnect is underway the original value is
  re-queued ahead of newer sends; otherwise it surfaces as a `drop`. Never
  silently lost.
- **Heartbeat pings bypass outbound middleware** entirely.

## Writing middleware once, typing it

Middleware is typed by the client's generics: inbound contexts carry `TIn`,
outbound contexts carry `TOut`.

```ts
const client = defineClient<ServerMsg, ClientMsg>({ url });

client.use({
    outbound: (ctx, next) => {
        ctx.data; // ClientMsg
        return next();
    }
});
```
