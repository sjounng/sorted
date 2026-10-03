import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri 개발 서버 설정 (Tauri 공식 템플릿 기준)
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  test: {
    // 앱 화면과 확장의 순수 함수 테스트를 함께 돌린다.
    dir: "..",
    include: ["app/src/**/*.test.ts", "extension/src/**/*.test.js"],
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      // Rust 쪽 파일이 바뀌어도 화면을 다시 빌드하지 않는다.
      ignored: ["**/src-tauri/**", "**/core/**", "**/native-host/**", "**/target/**"],
    },
  },
});
