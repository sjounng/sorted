import { StrictMode, useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createRoot } from "react-dom/client";
import "@fontsource/nanum-pen-script/400.css";
import { applyStoredTheme } from "./theme";
import { startLanguage, useLanguage } from "./i18n";
import { currentView, viewTitle } from "./windows";
import { Assign } from "./views/Assign";
import { Cleanup } from "./views/Cleanup";
import { Compare } from "./views/Compare";
import { Duplicate } from "./views/Duplicate";
import { MessageLog } from "./views/MessageLog";
import { Home } from "./views/Home";
import { Setup } from "./views/Setup";

// 창마다 같은 index.html을 쓰고, ?view=와 ?id=로 화면을 고른다 (windows.ts).
// 목업에서는 id가 없어도 화면이 뜨도록 예시 id를 쓴다.
function App() {
  // 언어가 바뀌면 창 전체를 다시 그리고, 창 제목도 그 언어로
  const language = useLanguage();
  const { view, id } = currentView();
  useEffect(() => {
    document.title = viewTitle(view);
    if (isTauri())
      getCurrentWindow()
        .setTitle(viewTitle(view))
        .catch(() => {});
  }, [language, view]);
  switch (view) {
    case "log":
      return <MessageLog />;
    case "setup":
      return <Setup />;
    case "assign":
      return <Assign id={id ?? "u1"} />;
    case "duplicate":
      return <Duplicate id={id ?? "d1"} />;
    case "compare":
      return <Compare id={id ?? "6aa284ef1cf74"} />;
    case "cleanup":
      return <Cleanup id={id ?? "6aa284ef1cf74"} />;
    default:
      return <Home />;
  }
}

document.body.dataset.view = currentView().view;
applyStoredTheme();
startLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
