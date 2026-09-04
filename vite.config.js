import { defineConfig } from "vite";
import path from "node:path";

const defaultPort = parseInt(process.env.PORT || process.env.VITE_PORT || "9001", 10);

export default defineConfig(({ mode }) => {
    const isDist = process.env.DIST === "true";
    const ext = isDist ? "min.js" : "js";

    return {
        root: "html",
        server: {
            port: defaultPort,
            strictPort: false,
            open: true
        },
        build: {
            outDir: path.resolve(__dirname, "dist"),
            emptyOutDir: !isDist,
            minify: isDist,
            lib: {
                entry: path.resolve(__dirname, "client/index.js"),
                name: "SHAREDSTATE",
                formats: ["es", "iife", "cjs", "umd"],
                fileName: (format) => `sharedstate.${format}.${ext}`
            }
        }
    };
});
