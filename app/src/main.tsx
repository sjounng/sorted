import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MessageLog } from "./MessageLog";
import { Popover } from "./popover/Popover";

// 창마다 같은 index.html을 쓰고, 창 이름(label)으로 화면을 고른다.
// 브라우저에서 화면만 볼 때는 ?view=popover 처럼 주소로 고른다.
function currentView(): string {
  if (isTauri()) return getCurrentWindow().label;
  return new URLSearchParams(location.search).get("view") ?? "popover";
}

const views: Record<string, () => React.JSX.Element> = {
  popover: Popover,
  main: MessageLog,
};

const View = views[currentView()] ?? Popover;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <View />
  </StrictMode>,
);
