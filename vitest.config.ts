import { defineConfig } from "vitest/config";

// The backend tests are plain TypeScript, so they run without SvelteKit.
// (Running SvelteKit's plugin inside tests would rewrite its generated files and reload the dev site.)
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
