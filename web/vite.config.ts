import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The Zama SDK pulls in Node built-ins (Buffer, process, global) that do
    // not exist in the browser. Without these polyfills the SDK throws on
    // first use, usually with an opaque "Buffer is not defined".
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  optimizeDeps: {
    // The SDK ships WASM and must not be pre-bundled by esbuild — pre-bundling
    // mangles the WASM import and the relayer client fails to initialise.
    exclude: ["@zama-fhe/sdk"],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          wallet: [
            "wagmi",
            "viem",
            "@rainbow-me/rainbowkit",
            "@tanstack/react-query",
          ],
        },
      },
    },
  },
});
