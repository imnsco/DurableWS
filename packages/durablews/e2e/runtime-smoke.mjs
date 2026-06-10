// Cross-runtime smoke test: the same script runs unchanged under Node ≥22,
// Deno, and Bun against the built ESM bundle and a real echo server
// (e2e/echo-standalone.mjs, running under Node). It proves the §6 claim —
// "multi-runtime via the standard global WebSocket" — per runtime:
//   1. lifecycle walk (idle → connecting → open) and an echo round trip
//   2. transparent reconnection after a server-initiated drop
//   3. queueing while disconnected, flushed after recovery
//
// Usage: WS_PORT=8787 {node|deno run --allow-net --allow-read|bun} runtime-smoke.mjs
// Exits 0 on success, 1 on any failure or after a 20s watchdog.

import { defineClient } from "../dist/index.js";

const port = Number(
    (globalThis.Deno
        ? globalThis.Deno.env.get("WS_PORT")
        : process.env.WS_PORT) ?? 8787
);
const url = `ws://127.0.0.1:${port}`;

const watchdog = setTimeout(() => {
    console.error("FAIL: smoke test timed out after 20s");
    exit(1);
}, 20_000);

function exit(code) {
    clearTimeout(watchdog);
    if (globalThis.Deno) {
        globalThis.Deno.exit(code);
    } else {
        process.exit(code);
    }
}

function assert(condition, label) {
    if (!condition) {
        console.error(`FAIL: ${label}`);
        exit(1);
    }
    console.log(`ok: ${label}`);
}

function nextMessage(client) {
    return new Promise((resolve) => {
        const off = client.on("message", (msg) => {
            off();
            resolve(msg);
        });
    });
}

const client = defineClient({
    url,
    reconnect: { baseDelay: 50, jitter: false }
});

// 1. Lifecycle + echo round trip.
assert(client.state === "idle", "starts idle");
const opened = client.connect();
assert(client.state === "connecting", "connecting after connect()");
await opened;
assert(client.state === "open", "open after connect() resolves");

const echoed = nextMessage(client);
client.send({ runtime: "smoke", n: 1 });
const reply = await echoed;
assert(
    reply !== null &&
        typeof reply === "object" &&
        reply.runtime === "smoke" &&
        reply.n === 1,
    "JSON echo round trip"
);

// 2. Server drop → transparent reconnection.
const reconnecting = new Promise((resolve) => {
    const off = client.on("reconnecting", (info) => {
        off();
        resolve(info);
    });
});
const reopened = new Promise((resolve) => {
    const off = client.on("open", () => {
        off();
        resolve(null);
    });
});
client.send("drop");
const retry = await reconnecting;
assert(retry.attempt === 1, "reconnecting event after server drop");

// 3. Queue while disconnected (the socket is gone, the retry is pending).
client.send({ queued: true });
assert(client.getState().queueLength === 1, "send() queued while reconnecting");

await reopened;
assert(client.state === "open", "transparently reconnected");
const flushed = await nextMessage(client);
assert(
    flushed !== null && typeof flushed === "object" && flushed.queued === true,
    "queued message flushed after recovery"
);
assert(client.getState().queueLength === 0, "queue drained");

client.close();
console.log("smoke: all checks passed");
exit(0);
