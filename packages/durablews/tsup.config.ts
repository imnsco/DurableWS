import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts", "src/vue.ts", "src/react.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    outDir: "dist"
});
