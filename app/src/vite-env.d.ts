/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "tauri"면 실제 앱 본체를, 그 밖에는 목업을 쓴다 */
  readonly VITE_BACKEND?: string;
}
