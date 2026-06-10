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
                        { label: "Why DurableWS?", slug: "comparison" },
                    ],
                },
                {
                    label: "Guides",
                    items: [
                        { label: "Durability tuning", slug: "guides/durability" },
                        { label: "Middleware", slug: "guides/middleware" },
                        { label: "Codecs", slug: "guides/codecs" },
                        {
                            label: "Migrating from v1",
                            slug: "guides/migrating-from-v1",
                        },
                    ],
                },
                {
                    label: "Frameworks",
                    items: [
                        { label: "Vue", slug: "frameworks/vue" },
                        { label: "React", slug: "frameworks/react" },
                    ],
                },
                {
                    label: "Reference",
                    items: [{ label: "API reference", slug: "reference/api" }],
                },
            ],
        }),
    ],
});
