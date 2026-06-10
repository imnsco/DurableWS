import { useWebSocket } from "durablews/react";
import { useEffect, useRef, useState } from "react";
import {
    CHAT_URL,
    type ServerMessage,
    ServerMessage as schema
} from "../../shared/schema";

const name = `react-${Math.floor(Math.random() * 1000)}`;

type ChatLine = Extract<ServerMessage, { type: "chat" }>;

export function App() {
    // The hook owns the client: connects on mount, closes on unmount. The
    // zod schema types every message AND runtime-validates it.
    const { state, send, client } = useWebSocket({ url: CHAT_URL, schema });

    const [messages, setMessages] = useState<ChatLine[]>([]);
    const [presence, setPresence] = useState(0);
    const [typing, setTyping] = useState("");
    const typingTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    // History is app state — subscribe to every message on the client.
    useEffect(() => {
        return client.on("message", (msg) => {
            if (msg.type === "chat") {
                setMessages((prior) => [...prior.slice(-49), msg]);
                setTyping("");
            } else if (msg.type === "presence") {
                setPresence(msg.count);
            } else if (msg.type === "typing" && msg.name !== name) {
                setTyping(`${msg.name} is typing…`);
                clearTimeout(typingTimer.current);
                typingTimer.current = setTimeout(() => setTyping(""), 1500);
            }
        });
    }, [client]);
    useEffect(() => () => clearTimeout(typingTimer.current), []);

    const [draft, setDraft] = useState("");
    const lastTypingSentAt = useRef(0);
    // Typing indicators via the call-site-throttle pattern from the
    // middleware guide — not pipeline middleware.
    function onInput(value: string) {
        setDraft(value);
        const now = Date.now();
        if (now - lastTypingSentAt.current > 1000 && client.state === "open") {
            lastTypingSentAt.current = now;
            send({ type: "typing", name });
        }
    }
    function submit(event: React.FormEvent) {
        event.preventDefault();
        if (!draft.trim()) {
            return;
        }
        // Queues transparently if we happen to be reconnecting.
        send({ type: "chat", name, body: draft });
        setDraft("");
    }

    return (
        <main
            style={{
                fontFamily: "system-ui",
                maxWidth: 560,
                margin: "2rem auto"
            }}
        >
            <h1>
                DurableWS chat <small>(React)</small>
            </h1>
            <p>
                <b style={{ color: state === "open" ? "green" : "darkorange" }}>
                    {state}
                </b>{" "}
                · {presence} online · you are {name}
            </p>
            <ul style={{ minHeight: 240, listStyle: "none", padding: 0 }}>
                {messages.map((m) => (
                    <li key={`${m.at}-${m.name}`}>
                        <b>{m.name}:</b> {m.body}
                    </li>
                ))}
            </ul>
            <p style={{ opacity: 0.6, fontStyle: "italic" }}>{typing}&nbsp;</p>
            <form onSubmit={submit}>
                <input
                    value={draft}
                    onChange={(e) => onInput(e.target.value)}
                    placeholder="Say something…"
                    style={{ width: "70%", padding: "0.5rem" }}
                />
                <button type="submit">Send</button>
            </form>
        </main>
    );
}
