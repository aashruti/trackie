import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "alert", message: "Use useAppDialog().showAlert() for a Trackie-styled notice." },
        { name: "confirm", message: "Use useAppDialog().confirmAction() for a Trackie-styled confirmation." },
        { name: "prompt", message: "Use useAppDialog().promptForText() for a Trackie-styled prompt." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "alert", message: "Use useAppDialog().showAlert()." },
        { object: "window", property: "confirm", message: "Use useAppDialog().confirmAction()." },
        { object: "window", property: "prompt", message: "Use useAppDialog().promptForText()." },
        { object: "globalThis", property: "alert", message: "Use useAppDialog().showAlert()." },
        { object: "globalThis", property: "confirm", message: "Use useAppDialog().confirmAction()." },
        { object: "globalThis", property: "prompt", message: "Use useAppDialog().promptForText()." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
