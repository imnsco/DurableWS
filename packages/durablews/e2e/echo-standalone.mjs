import { WebSocketServer } from "ws";

// Runs the e2e echo server as a long-lived process for the cross-runtime
// smoke tests: Deno/Bun can't host the Node `ws` server themselves, so it
// runs under Node and they connect to it. Same protocol as echo-server.mjs
// ("ping" → "pong", "drop" → close 1012, "mute" → silence; otherwise echo).
// WS_PORT pins the port (default 8787); prints `PORT=<n>` when listening.
const port = process.env.WS_PORT ? Number(process.env.WS_PORT) : 8787;

const wss = new WebSocketServer({ port }, () => {
    console.log(`PORT=${port}`);
});

wss.on("connection", (socket) => {
    let muted = false;
    socket.on("message", (data) => {
        const text = data.toString();
        if (text === "mute") {
            muted = true;
            return;
        }
        if (muted) {
            return;
        }
        if (text === "drop") {
            socket.close(1012, "server drop");
            return;
        }
        socket.send(text === "ping" ? "pong" : text);
    });
});
