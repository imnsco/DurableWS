import { WebSocketServer } from "ws";

// A minimal broadcast chat server shared by the Vue and React clients.
// Client → server: {type:"chat", name, body} | {type:"typing", name}
// Server → client: the same, broadcast — plus {type:"presence", count}.
const PORT = 8789;

const wss = new WebSocketServer({ port: PORT }, () => {
    console.log(`chat server: ws://localhost:${PORT}`);
});

function broadcast(message) {
    const wire = JSON.stringify(message);
    for (const socket of wss.clients) {
        if (socket.readyState === socket.OPEN) {
            socket.send(wire);
        }
    }
}

wss.on("connection", (socket) => {
    broadcast({ type: "presence", count: wss.clients.size });
    socket.on("close", () => {
        broadcast({ type: "presence", count: wss.clients.size });
    });
    socket.on("message", (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }
        if (msg.type === "chat" && msg.name && typeof msg.body === "string") {
            broadcast({
                type: "chat",
                name: String(msg.name),
                body: msg.body,
                at: Date.now()
            });
        }
        if (msg.type === "typing" && msg.name) {
            broadcast({ type: "typing", name: String(msg.name) });
        }
    });
});
