import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // Existing Supabase query records are untyped. Keep findings visible without
  // changing database or application behavior in this tooling-only maintenance.
  {
    files: ["app/page.tsx", "app/cases/**/page.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "warn" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
