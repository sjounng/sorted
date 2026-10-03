import { useEffect, useState } from "react";

// 사용자가 정한 이름 ("Hello, 예원!"). 화면에서만 쓰는 값이라 앱 내부에 보내지 않고 이 Mac의 화면 저장소에 둔다.
// 저장소를 쓸 수 없으면(사생활 보호 모드 등) 이번 실행 동안만 기억한다.

const KEY = "sorted.displayName";
const MAX = 20;

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

function write(name: string) {
  try {
    if (name) localStorage.setItem(KEY, name);
    else localStorage.removeItem(KEY);
  } catch {
    // 저장하지 못해도 화면에는 그대로 보인다
  }
}

/** 이름과 바꾸는 함수. 다른 창에서 바꿔도 따라온다. */
export function useDisplayName(): [string, (name: string) => void] {
  const [name, setName] = useState(read);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setName(e.newValue ?? "");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = (next: string) => {
    const clean = next.trim().slice(0, MAX);
    write(clean);
    setName(clean);
  };
  return [name, save];
}

/** 아바타에 쓸 첫 글자. 이름이 없으면 "S" */
export function initial(name: string): string {
  return name ? Array.from(name)[0].toUpperCase() : "S";
}
