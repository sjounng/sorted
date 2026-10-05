import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { t } from "./i18n";

// 화면 하나 = 창 하나. 모든 창이 같은 index.html을 쓰고 ?view=로 화면을 고른다.
// 브라우저(목업 확인용)에서는 새 탭으로 연다.

export type View = "main" | "log" | "setup" | "assign" | "duplicate" | "compare" | "cleanup";

const SIZES: Record<View, { width: number; height: number }> = {
  main: { width: 1200, height: 780 },
  log: { width: 480, height: 600 },
  setup: { width: 460, height: 640 },
  assign: { width: 420, height: 480 },
  duplicate: { width: 420, height: 260 },
  compare: { width: 1040, height: 700 },
  cleanup: { width: 420, height: 300 },
};

/** 창 제목. 지금 언어를 따른다 (앱 내부가 띄우는 창도 같은 제목을 쓴다: lib.rs) */
export function viewTitle(view: View): string {
  switch (view) {
    case "main":
      return "Sorted";
    case "log":
      return t("Sorted Message Log", "Sorted 메시지 기록");
    case "setup":
      return t("Welcome to Sorted", "Sorted 시작하기");
    case "assign":
      return t("Choose a Class", "과목 지정");
    case "duplicate":
      return t("Already Downloaded", "이미 받은 파일");
    case "compare":
      return t("Compare Versions", "변경 비교");
    case "cleanup":
      return t("Clean Up Old Version", "이전 버전 정리");
  }
}

export function currentView(): { view: View; id: string | null } {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get("view");
  const fallback = isTauri() ? getCurrentWindow().label : "main";
  const view = (fromUrl ?? fallback) as View;
  return { view: view in SIZES ? view : "main", id: params.get("id") };
}

/** 화면을 창으로 연다. 같은 화면·같은 id의 창이 이미 있으면 앞으로 가져온다. */
export async function openView(view: View, id?: string) {
  const query = new URLSearchParams({ view });
  if (id) query.set("id", id);
  const url = `index.html?${query}`;

  if (!isTauri()) {
    window.open(`/${url}`, "_blank");
    return;
  }

  const label = id ? `${view}-${id}`.replace(/[^a-zA-Z0-9_-]/g, "_") : view;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  const { width, height } = SIZES[view];
  const title = viewTitle(view);
  new WebviewWindow(label, { url, title, width, height, center: true, focus: true });
}

/** 지금 창을 닫는다. 브라우저에서는 탭을 닫아 본다. */
export async function closeSelf() {
  if (isTauri()) await getCurrentWindow().close();
  else window.close();
}
