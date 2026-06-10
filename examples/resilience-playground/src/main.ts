import { defineClient } from "durablews";

// Everything durable is ON: default reconnection (full-jitter backoff) and
// queueing, plus an aggressive heartbeat so the "mute" sabotage is detected
// in seconds rather than relying on TCP timeouts.
const ws = defineClient({
    url: "ws://localhost:8788",
    heartbeat: { interval: 2000, timeout: 2500 }
});

const el = (id: string) => {
    const node = document.getElementById(id);
    if (!node) {
        throw new Error(`missing #${id}`);
    }
    return node;
};
const log = (line: string, kind = "info") => {
    const pane = el("log");
    const at = new Date().toLocaleTimeString();
    pane.append(`${at}  ${kind === "bad" ? "✗" : "•"} ${line}\n`);
    pane.scrollTop = pane.scrollHeight;
};

// The reactive seam: one subscription drives every gauge.
function render() {
    const { state, retryAttempt, queueLength } = ws.getState();
    const badge = el("state");
    badge.textContent = state;
    badge.dataset.state = state;
    el("retries").textContent = String(retryAttempt);
    el("queued").textContent = String(queueLength);
}
ws.subscribe(render);
render();

ws.on("open", () => log("open — connected"));
ws.on("close", (event) => log(`close (code ${event.code})`, "bad"));
ws.on("reconnecting", ({ attempt, delay }) =>
    log(`reconnecting: attempt ${attempt} in ${Math.round(delay)}ms`)
);
ws.on("error", (err) =>
    log(
        `error: ${err instanceof Error ? err.message : "transport error"}`,
        "bad"
    )
);
ws.on("drop", ({ data, reason }) =>
    log(`DROPPED (${reason}): ${JSON.stringify(data)}`, "bad")
);
ws.on("message", (msg) => {
    const m = msg as { type?: string; body?: unknown; at?: number };
    if (m?.type === "tick") {
        log("tick from server");
        return;
    }
    if (m?.type === "echo") {
        log(`echo: ${JSON.stringify(m.body)}`);
        return;
    }
    log(`message: ${JSON.stringify(msg)}`);
});

let n = 0;
el("drop").onclick = () => {
    log("asking the server to drop us…");
    ws.send({ type: "drop" });
};
el("mute").onclick = () => {
    log("muting the server 6s — watch the heartbeat declare it dead (4408)");
    ws.send({ type: "mute", ms: 6000 });
};
el("send").onclick = () => {
    ws.send({ type: "echo", body: `hello #${++n}` });
};
el("burst").onclick = () => {
    log("sending 5 — if we're down, watch them queue, then flush on open");
    for (let i = 0; i < 5; i++) {
        ws.send({ type: "echo", body: `burst ${++n}` });
    }
};
el("close").onclick = () => {
    ws.close();
};
el("connect").onclick = () => {
    ws.connect().catch(() => {});
};

ws.connect().catch(() => {});
