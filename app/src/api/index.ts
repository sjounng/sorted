import type { Backend } from "./backend";
import { mockBackend } from "./mock";
import { tauriBackend } from "./tauri";

export type { Backend } from "./backend";
export * from "./types";

/**
 * 화면은 항상 이 api를 통해서만 앱 본체와 대화한다.
 * 기본은 목업이다. Rust 명령을 다 만들면 `VITE_BACKEND=tauri npm run tauri dev`로 바꿔 확인하고,
 * 끝나면 기본값을 tauri로 뒤집는다.
 */
export const api: Backend = import.meta.env.VITE_BACKEND === "tauri" ? tauriBackend : mockBackend;
export { courseNameProblem } from "./validate";
