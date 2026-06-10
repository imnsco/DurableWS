import { WebSocketServer } from "ws";

// A deliberately sabotage-able WebSocket server for the resilience
// playground. The CLIENT asks the server to misbehave:
//   {type:"drop"}            → server closes the connection (code 1012)
//   {type:"mute", ms}        → server goes silent on this connection for ms
//                              (open-but-dead link: heartbeat territory)
//   {type:"echo", body}      → echoed back
//   "ping" (raw)             → "pong" (heartbeat reply)
// It also ticks a timestamp every 2s per connection so traffic is visible.
const PORT = 8788;

const wss = new WebSocketServer({ port: PORT }, () => {
    console.log(`resilience playground server: ws://localhost:${PORT}`);
});

wss.on("connection", (socket) => {
    let mutedUntil = 0;
    const muted = () => Date.now() < mutedUntil;

    const ticker = setInterval(() => {
        if (!muted() && socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "tick", at: Date.now() }));
        }
    }, 2000);
    socket.on("close", () => clearInterval(ticker));

    socket.on("message", (data) => {
        const text = data.toString();
        if (text === "ping") {
            if (!muted()) {
                socket.send("pong");
            }
            return;
        }
        let msg;
        try {
            msg = JSON.parse(text);
        } catch {
            return;
        }
        if (msg.type === "drop") {
            socket.close(1012, "you asked for it");
            return;
        }
        if (msg.type === "mute") {
            mutedUntil = Date.now() + (msg.ms ?? 6000);
            return;
        }
        if (muted()) {
            return;
        }
        if (msg.type === "echo") {
            socket.send(JSON.stringify({ type: "echo", body: msg.body }));
        }
    });
});
