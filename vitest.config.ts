import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // `server-only` throws outside an RSC bundle; stub it so server-only
      // modules can be unit-tested for their pure exports.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url)
      ),
      // Mirror the Next "@/*" path alias so route handlers (which import via
      // "@/lib/…") resolve under Vitest too.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
