// The entire migration from fragile to durable is this import. The rest of
// this file is written against the standard WebSocket API — swap the line
// below for the global WebSocket and the app still runs, it just dies the
// moment the server blips.
import { WebSocket } from "durablews/compat";

const ws = new WebSocket("ws://localhost:8790");

const textarea = document.getElementById("doc") as HTMLTextAreaElement;
const badge = document.getElementById("state") as HTMLElement;

ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data)) as {
        type: string;
        text: string;
    };
    if (msg.type === "doc" && msg.text !== textarea.value) {
        // Last-write-wins with a crude cursor save — demo-grade collaboration
        // on purpose; the point here is the transport, not OT/CRDT.
        const cursor = textarea.selectionStart;
        textarea.value = msg.text;
        textarea.setSelectionRange(cursor, cursor);
    }
};

let throttle: ReturnType<typeof setTimeout> | undefined;
textarea.addEventListener("input", () => {
    clearTimeout(throttle);
    throttle = setTimeout(() => {
        // While the server is down this queues (bounded, observable) and
        // flushes on recovery — the standard API gained durability semantics.
        ws.send(JSON.stringify({ type: "update", text: textarea.value }));
    }, 150);
});

// Everything above sticks to the WebSocket shape. This is the escape hatch:
// the full durablews client underneath, here driving the state badge.
ws.client.subscribe(() => {
    const { state } = ws.client.getState();
    badge.textContent = state;
    badge.dataset.state = state;
});
