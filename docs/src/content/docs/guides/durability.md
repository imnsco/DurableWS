---
title: Durability tuning
description: Reconnection, queueing, and heartbeat, the defaults, and every knob.
---

DurableWS is durable by default: reconnection and queueing are **on** with
zero configuration, heartbeat is opt-in. This page is every knob and the
reasoning behind the defaults.

## Reconnection

Any close the user didn't ask for schedules a reconnect with **full-jitter
exponential backoff**: each delay is drawn uniformly from
`[0, min(maxDelay, baseDelay × factor^attempt)]`, so a fleet of clients
dropped by the same outage doesn't retry in synchronized waves.

```ts
const client = defineClient({
    url,
    reconnect: {
        baseDelay: 500,      // first-retry ceiling (ms)
        factor: 2,           // exponential growth
        maxDelay: 30_000,    // delay ceiling (ms)
        jitter: true,        // full jitter (see above)
        maxRetries: Infinity,
        shouldReconnect: (event) => event.code !== 4001
    }
});
```

| Option | Default | Notes |
| --- | --- | --- |
| `baseDelay` | `500` | ms |
| `factor` | `2` | |
| `maxDelay` | `30_000` | ms |
| `jitter` | `true` | `false` = exact exponential delays |
| `maxRetries` | `Infinity` | per disconnection episode |
| `shouldReconnect` | always | per-close veto; user `close()` never retries regardless |

Disable entirely with `reconnect: false`.

Each scheduled retry fires a `reconnecting` event (`{ attempt, delay }`), and
`retryAttempt` appears in `getState()`, show it in your UI. A successful open
resets the attempt counter.

### `connect()` under unlimited retries

`connect()` resolves on the **first successful open**: including when that
open is a successful retry, and rejects only on *terminal* failure (retries
exhausted, a `shouldReconnect` veto, or `close()` before the first open).
Under the default `maxRetries: Infinity` it therefore **never rejects**:
against a down host it stays pending while the client keeps trying. Need a
deadline? Race it:

```ts
await Promise.race([
    client.connect(),
    new Promise((_, reject) =>
        setTimeout(() => reject(new Error("connect timeout")), 10_000)
    )
]);
```

### Vetoing by close code

`shouldReconnect` receives the `CloseEvent`. The classic use is refusing to
retry application-level rejections (e.g. an auth failure your server signals
with a custom code) while still retrying infrastructure drops:

```ts
reconnect: {
    shouldReconnect: ({ code }) => code !== 4001 // your "unauthorized" code
}
```

## Queueing

`send()` while `connecting` or `reconnecting` **queues** the message and
flushes the backlog, in order, the moment the socket opens, before the `open`
event fires, so queued messages precede anything an open-handler sends.

The queue is **bounded** (default `256`) with a **drop-oldest** policy, and a
drop is never silent: every dropped message fires a `drop` event carrying the
exact value you passed to `send()` and the reason, `"overflow"` (queue was
full) or `"close"` (the connection ended with messages still waiting).

```ts
const client = defineClient({ url, queue: { maxSize: 1000 } });

client.on("drop", ({ data, reason }) => {
    console.warn(`message not sent (${reason})`, data);
});
```

`send()` still throws in states where no open is coming (`idle`, `closing`,
`closed`), and always when `queue: false`.

The queue stores the **raw values** you passed to `send()`, encoding (and
outbound middleware) run at transmission time, so a message queued across a
reconnect goes out with, e.g., a token that is fresh when it actually leaves.

## Heartbeat

Opt-in, because it requires a server that answers (or talks regularly for its
own reasons), an app-level contract the library can't assume:

```ts
const client = defineClient({
    url,
    heartbeat: {
        interval: 15_000, // ping every 15s while open
        message: "ping",  // run through the codec; default "ping"
        timeout: 10_000   // default: interval
    }
});
```

While open, the client sends `message` every `interval`. **Any inbound frame**
counts as liveness, a busy connection never pays for explicit pongs. If
nothing arrives within `timeout` of a ping, the link is declared dead: an
`error` is emitted, the socket is closed with the app-reserved code **4408**
(exported as `HEARTBEAT_TIMEOUT_CODE`), and the close flows into the normal
reconnect machinery.

Heartbeat pings bypass outbound middleware, they are transport-level
liveness, not app messages.

## Observing all of it

```ts
const { state, lastError, retryAttempt, queueLength } = client.getState();

const unsubscribe = client.subscribe(() => {
    render(client.getState()); // fires on any snapshot change
});
```

Snapshots are frozen and referentially stable between changes, see the
[Vue](/frameworks/vue/) and [React](/frameworks/react/) bindings, which are
built on exactly this pair.
