import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

// Deliberately not enabled: eslint-plugin-react-refresh. Its
// only-export-components rule flags this codebase's convention of keeping a
// small helper next to the component it serves (WorklogFields exports its
// draft hook, MissingRow its list-key helper). The rule only buys hot-reload
// fidelity in dev, which does not justify either splitting those modules or
// carrying disable comments in each of them.

export default tseslint.config(
  // The Rust side has its own toolchain (clippy); dist is build output.
  { ignores: ["dist", "src-tauri"] },

  js.configs.recommended,
  tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // Node, not the browser: this one runs in the Vite build process.
  {
    files: ["vite.config.ts"],
    languageOptions: { globals: globals.node },
  },

  // Must stay last — switches off every rule Prettier already decides.
  prettier,
);
