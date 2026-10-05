import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Backend } from "./backend";
import type { Settings } from "./types";

// 실제 앱 본체 호출. Rust 쪽에 같은 이름의 #[tauri::command]를 만들면 그대로 동작한다.
// 인자 이름은 Tauri가 camelCase → snake_case로 바꿔 준다 (fileId → file_id).
// 아직 Rust 명령이 없으므로 api/index.ts에서 VITE_BACKEND=tauri일 때만 쓴다.

export const tauriBackend: Backend = {
  settings: () => invoke("settings"),
  setLanguage: (language) => invoke("set_language", { language }),
  onSettingsChanged: (callback) =>
    listen<Settings>("settings-changed", (event) => callback(event.payload)),

  overview: () => invoke("overview"),
  onOverviewChanged: (callback) => listen("overview-changed", () => callback()),

  courseDetail: (courseId) => invoke("course_detail", { courseId }),
  addCourse: (name) => invoke("add_course", { name }),
  renameCourse: (courseId, name) => invoke("rename_course", { courseId, name }),
  removeCourse: (courseId) => invoke("remove_course", { courseId }),

  schedule: () => invoke("schedule"),
  openInBrowser: (url) => invoke("open_in_browser", { url }),

  trash: () => invoke("trash"),
  restoreCourse: (courseId) => invoke("restore_course", { courseId }),
  purgeCourse: (courseId) => invoke("purge_course", { courseId }),
  emptyTrash: () => invoke("empty_trash"),
  openFile: (path) => invoke("open_file", { path }),

  setupStatus: () => invoke("setup_status"),
  requestDownloadsAccess: () => invoke("request_downloads_access"),
  openSystemSettings: () => invoke("open_system_settings"),
  revealInFinder: (path) => invoke("reveal_in_finder", { path }),

  assignRequest: (fileId) => invoke("assign_request", { fileId }),
  assignCourse: (fileId, choice) => invoke("assign_course", { fileId, choice }),
  skipAssign: (fileId) => invoke("skip_assign", { fileId }),

  duplicateNotice: (id) => invoke("duplicate_notice", { id }),
  resolveDuplicate: (id, choice) => invoke("resolve_duplicate", { id, choice }),

  comparison: (documentId) => invoke("comparison", { documentId }),

  cleanupRequest: (documentId) => invoke("cleanup_request", { documentId }),
  resolveCleanup: (documentId, choice) => invoke("resolve_cleanup", { documentId, choice }),
};
