import { defineConfig } from "vite";

// Tauri 개발 서버 설정 (Tauri 공식 템플릿 기준)
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
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
