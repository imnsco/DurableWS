import { WebSocketServer } from "ws";

/**
 * Starts a throwaway WebSocket server on a random free port for the browser
 * e2e tests. It echoes any message back, with three special textual commands:
 * "ping" is answered with "pong" (pingpong middleware); "drop" makes the
 * server close that connection; "mute" makes the server stop responding on
 * that connection (a silent-but-open link, for the heartbeat e2e). The server
 * itself stays up, so a reconnecting client always gets a fresh, unmuted
 * connection.
 *
 * @returns the chosen port and a close() that resolves once the server is down.
 */
export function startEchoServer() {
    return new Promise((resolve) => {
        const wss = new WebSocketServer({ port: 0 }, () => {
            const address = wss.address();
            const port =
                typeof address === "object" && address ? address.port : 0;
            resolve({
                port,
                close: () => new Promise((done) => wss.close(() => done()))
            });
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
    });
}
