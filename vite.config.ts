import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [preact(), cloudflare()],
  environments: {
    client: {
      build: {
        rollupOptions: {
          input: { student: "index.html", teacher: "t/index.html" },
        },
      },
    },
  },
});
