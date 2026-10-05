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
    // 크롬 확장의 콘텐츠 스크립트: LMS 페이지 안에서 돌아 window 등 브라우저 전역을 쓴다 (FR-19).
    // 모듈이 아니라 일반 스크립트로 들어간다.
    files: ["extension/src/weekly-page.js", "extension/src/weekly-bridge.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, chrome: "readonly" },
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
