import { defineConfig } from "vitest/config";

export default defineConfig({
  // I test girano in node: proto, store, clock e YIN non toccano il DOM, ed è
  // esattamente per questo che sono moduli separati.
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
