import { useSyncExternalStore } from "react";
import { api, type Language } from "./api";

// 화면 문구의 언어 (#46). 언어는 앱 본체가 저장하고, 바뀌면 열린 창마다 settings-changed를 받는다.
// 문구는 쓰는 자리에서 t("English", "한국어")처럼 두 언어를 나란히 적는다.
// 최상위 App이 useLanguage()를 부르므로, 언어가 바뀌면 창 전체가 다시 그려진다.
// <html lang>은 바꾸지 않는다: WebKit이 lang에 따라 시스템 글꼴(-apple-system)을 달리 골라
// 영문·숫자까지 글꼴이 바뀌고 화면 전체가 움직인다. 글자만 바뀌게 한다.

let current: Language = navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
const listeners = new Set<() => void>();

function set(language: Language) {
  if (language === current) return;
  current = language;
  listeners.forEach((l) => l());
}

/** 앱이 뜰 때 한 번: 저장된 언어를 읽고, 바뀌면 따라간다 */
export function startLanguage() {
  api
    .settings()
    .then((s) => set(s.language))
    .catch(() => {});
  api.onSettingsChanged((s) => set(s.language)).catch(() => {});
}

/** 지금 언어. 바뀌면 부른 컴포넌트가 다시 그려진다 */
export function useLanguage(): Language {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
  );
}

/** 지금 언어 (컴포넌트 밖의 함수용) */
export function language(): Language {
  return current;
}

/** 지금 언어의 문구 */
export function t(en: string, ko: string): string {
  return current === "ko" ? ko : en;
}

/** 언어를 바꾼다. 앱 본체가 저장하고 모든 창에 알린다 */
export async function changeLanguage(language: Language) {
  set(language);
  await api.setLanguage(language);
}
