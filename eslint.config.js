import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/node_modules/", "**/dist/", "**/target/", "app/src-tauri/gen/"] },
  js.configs.recommended,
  {
    // 크롬 확장: 서비스 워커에서 chrome.* API를 쓴다.
    files: ["extension/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.serviceworker, chrome: "readonly" },
    },
  },
  {
    // Tauri 앱 화면
    files: ["app/src/**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.js", "app/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
