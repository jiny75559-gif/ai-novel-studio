import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  build: {
    rollupOptions: { output: { manualChunks: { graph: ["@xyflow/react"] } } },
  },
  test: { environment: "node" },
} as Parameters<typeof defineConfig>[0]);
