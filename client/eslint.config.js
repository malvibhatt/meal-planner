import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "axios",
              message:
                "Import the shared instance from @/api/axiosInstance instead.",
            },
          ],
        },
      ],
    },
  },
  {
    // The one file permitted to import axios directly, it's the thing every
    // other file is supposed to import instead.
    files: ["src/api/axiosInstance.ts"],
    rules: { "no-restricted-imports": "off" },
  },
]);
