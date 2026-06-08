import cloudflare from "@astrojs/cloudflare";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
    site: "https://durablews.imns.co",
    adapter: cloudflare({
        imageService: "compile",
    }),
    integrations: [
        starlight({
            title: "DurableWS",
            description:
                "A resilient, zero-dependency WebSocket client for TypeScript — durable by default.",
            social: [
                {
                    icon: "github",
                    label: "GitHub",
                    href: "https://github.com/imnsco/DurableWS",
                },
            ],
            sidebar: [
                {
                    label: "Start here",
                    items: [
                        { label: "Getting started", slug: "getting-started" },
                    ],
                },
            ],
        }),
    ],
});
