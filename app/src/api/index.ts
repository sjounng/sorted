import type { Backend } from "./backend";
import { mockBackend } from "./mock";
import { tauriBackend } from "./tauri";
import { isTauri } from "@tauri-apps/api/core";

export type { Backend } from "./backend";
export * from "./types";

/**
 * 화면은 항상 이 api를 통해서만 앱 본체와 대화한다.
 * Sorted 앱 안에서는 앱 내부(실제 LMS 자료·일정)를, 브라우저(localhost:1420)에서는 목업을 쓴다.
 * `VITE_BACKEND=mock` 또는 `tauri`로 어느 쪽이든 고정할 수 있다.
 */
function pick(): Backend {
  const forced = import.meta.env.VITE_BACKEND;
  if (forced === "mock") return mockBackend;
  if (forced === "tauri") return tauriBackend;
  return isTauri() ? tauriBackend : mockBackend;
}

export const api: Backend = pick();
export { courseNameProblem } from "./validate";
