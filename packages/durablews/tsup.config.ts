import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        vue: "src/vue.ts",
        react: "src/react.ts",
        compat: "src/compat.ts",
        middleware: "src/middleware/index.ts"
    },
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    outDir: "dist"
});
