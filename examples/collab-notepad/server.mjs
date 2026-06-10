import { WebSocketServer } from "ws";

// A last-write-wins shared notepad. The server owns the document: it sends
// the current text to every new connection and re-broadcasts updates to
// everyone else. Deliberately protocol-dumb — the client treats the socket
// as a plain pipe, which is exactly where a drop-in durable WebSocket shines.
const PORT = 8790;

let doc =
    "Type here. Open a second window. Then kill this server (Ctrl-C),\nkeep typing, restart it — and watch everything catch up.\n\n";

const wss = new WebSocketServer({ port: PORT }, () => {
    console.log(`collab notepad server: ws://localhost:${PORT}`);
});

wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "doc", text: doc }));
    socket.on("message", (data) => {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }
        if (msg.type === "update" && typeof msg.text === "string") {
            doc = msg.text;
            const wire = JSON.stringify({ type: "doc", text: doc });
            for (const peer of wss.clients) {
                if (peer !== socket && peer.readyState === peer.OPEN) {
                    peer.send(wire);
                }
            }
        }
    });
});
