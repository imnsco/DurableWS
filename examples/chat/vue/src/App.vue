<script setup lang="ts">
import { useWebSocket } from "durablews/vue";
import { onUnmounted, ref, watch } from "vue";
import {
    CHAT_URL,
    type ServerMessage,
    ServerMessage as schema
} from "../../shared/schema";

const name = `vue-${Math.floor(Math.random() * 1000)}`;

// The composable owns the client: connects now, closes on unmount. The zod
// schema types lastMessage AND runtime-validates every inbound frame.
const { state, lastMessage, send, client } = useWebSocket({
    url: CHAT_URL,
    schema
});

const messages = ref<Extract<ServerMessage, { type: "chat" }>[]>([]);
const presence = ref(0);
const typing = ref("");
let typingTimer: ReturnType<typeof setTimeout> | undefined;

// lastMessage keeps only the latest — accumulate history app-side, the
// boundary DurableWS deliberately doesn't cross.
watch(lastMessage, (msg) => {
    if (!msg) {
        return;
    }
    if (msg.type === "chat") {
        messages.value = [...messages.value.slice(-49), msg];
        typing.value = "";
    } else if (msg.type === "presence") {
        presence.value = msg.count;
    } else if (msg.type === "typing" && msg.name !== name) {
        typing.value = `${msg.name} is typing…`;
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
            typing.value = "";
        }, 1500);
    }
});
onUnmounted(() => clearTimeout(typingTimer));

const draft = ref("");
// The debounce-in-front-of-send() pattern from the middleware guide:
// typing indicators are a call-site policy, not pipeline middleware.
let lastTypingSentAt = 0;
function onInput() {
    const now = Date.now();
    if (now - lastTypingSentAt > 1000 && client.state === "open") {
        lastTypingSentAt = now;
        send({ type: "typing", name });
    }
}
function submit() {
    if (!draft.value.trim()) {
        return;
    }
    // Queues transparently if we happen to be reconnecting.
    send({ type: "chat", name, body: draft.value });
    draft.value = "";
}
</script>

<template>
    <main>
        <h1>DurableWS chat <small>(Vue)</small></h1>
        <p>
            <b :data-state="state">{{ state }}</b> · {{ presence }} online ·
            you are {{ name }}
        </p>
        <ul>
            <li v-for="m in messages" :key="m.at + m.name">
                <b>{{ m.name }}:</b> {{ m.body }}
            </li>
        </ul>
        <p class="typing">{{ typing }}&nbsp;</p>
        <form @submit.prevent="submit">
            <input
                v-model="draft"
                placeholder="Say something…"
                @input="onInput"
            />
            <button type="submit">Send</button>
        </form>
    </main>
</template>

<style>
body { font-family: system-ui, sans-serif; max-width: 560px; margin: 2rem auto; }
ul { min-height: 240px; list-style: none; padding: 0; }
.typing { opacity: 0.6; font-style: italic; }
input { width: 70%; padding: 0.5rem; }
b[data-state="open"] { color: green; }
b[data-state="reconnecting"], b[data-state="connecting"] { color: darkorange; }
</style>
