import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      name: "RelayChatWidget",
      formats: ["iife"],
      fileName: () => "widget.js"
    }
  }
});
