import { defineConfig } from "vitest/config";

export default defineConfig({
  // Supplied by vite.config.ts in a real build. Without it here, any component
  // reading it (Settings prints it as the build stamp) throws a ReferenceError
  // the moment it renders — so the value is arbitrary, but its presence is not.
  define: {
    __BUILT_AT__: JSON.stringify("2026-01-01T00:00:00.000Z"),
  },
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
