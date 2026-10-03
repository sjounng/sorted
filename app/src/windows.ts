import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

// 화면 하나 = 창 하나. 모든 창이 같은 index.html을 쓰고 ?view=로 화면을 고른다.
// 브라우저(목업 확인용)에서는 새 탭으로 연다.

export type View = "main" | "log" | "setup" | "assign" | "duplicate" | "compare" | "cleanup";

const SIZES: Record<View, { title: string; width: number; height: number }> = {
  main: { title: "Sorted", width: 960, height: 720 },
  log: { title: "Sorted 메시지 기록", width: 480, height: 600 },
  setup: { title: "Sorted 시작하기", width: 460, height: 520 },
  assign: { title: "과목 지정", width: 420, height: 480 },
  duplicate: { title: "이미 받은 파일", width: 420, height: 260 },
  compare: { title: "변경 비교", width: 1040, height: 700 },
  cleanup: { title: "이전 버전 정리", width: 420, height: 300 },
};

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
  const { title, width, height } = SIZES[view];
  new WebviewWindow(label, { url, title, width, height, center: true, focus: true });
}

/** 지금 창을 닫는다. 브라우저에서는 탭을 닫아 본다. */
export async function closeSelf() {
  if (isTauri()) await getCurrentWindow().close();
  else window.close();
}
