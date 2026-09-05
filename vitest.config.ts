import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The store modules touch localStorage and the Tauri IPC bridge at import
    // time; the setup file stands in for both. See src/test-support/setup.ts.
    setupFiles: ["./src/test-support/setup.ts"],
    coverage: {
      provider: "v8",
      // `lcov` is what CI uploads; `text` keeps the number in front of you
      // when running the suite locally.
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      // Everything shipped, whether a test imports it or not — otherwise an
      // untested file simply disappears from the number instead of lowering
      // it, which is the one thing a coverage gate must not allow.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/test-support/**",
        // The Vite entry point: three lines that mount the app, and running
        // them would mean rendering the whole tree.
        "src/main.tsx",
        "src/vite-env.d.ts",
      ],
    },
  },
});
