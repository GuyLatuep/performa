import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The store modules touch localStorage and the Tauri IPC bridge at import
    // time; the setup file stands in for both. See src/test-support/setup.ts.
    setupFiles: ["./src/test-support/setup.ts"],
  },
});
