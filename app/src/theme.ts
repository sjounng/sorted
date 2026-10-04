import { useEffect, useState } from "react";

// 라이트·다크 모드. 사용자가 고르기 전에는 시스템 설정을 따른다.
// 고른 값은 이 Mac의 화면 저장소에 두고, <html data-theme>로 styles.css에 알린다. 창끼리 맞춰진다.

export type Theme = "light" | "dark";

const KEY = "sorted.theme";
const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme | null) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

/** 앱이 뜰 때 한 번. 첫 화면이 그려지기 전에 불러 깜빡임을 막는다 */
export function applyStoredTheme() {
  apply(stored());
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) apply(stored());
  });
}

/** 지금 보이는 모드와 바꾸는 함수 */
export function useTheme(): [Theme, () => void] {
  const system = () => (window.matchMedia(SYSTEM_DARK).matches ? "dark" : "light");
  const [theme, setTheme] = useState<Theme>(() => stored() ?? system());

  useEffect(() => {
    const media = window.matchMedia(SYSTEM_DARK);
    const sync = () => setTheme(stored() ?? system());
    media.addEventListener("change", sync);
    window.addEventListener("storage", sync);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // 저장하지 못해도 이번 실행 동안은 바뀐다
    }
    apply(next);
    setTheme(next);
  };
  return [theme, toggle];
}
