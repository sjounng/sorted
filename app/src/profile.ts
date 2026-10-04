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

// 프로필 동그라미 색. 앱 팔레트에 어울리는 그라데이션 몇 가지 중에서 고른다. 이름처럼 화면 저장소에 둔다.

export interface AvatarColor {
  id: string;
  label: string;
  from: string;
  to: string;
}

export const AVATAR_COLORS: AvatarColor[] = [
  { id: "mist", label: "Mist", from: "#7fb5b7", to: "#7d5a77" },
  { id: "rose", label: "Rose", from: "#e5a3b3", to: "#a35b78" },
  { id: "lavender", label: "Lavender", from: "#c3b2e3", to: "#7a68a8" },
  { id: "sage", label: "Sage", from: "#b5c9a8", to: "#6f8a6b" },
  { id: "peach", label: "Peach", from: "#f2c1a0", to: "#c27a63" },
  { id: "dusk", label: "Dusk", from: "#8fa3c9", to: "#5b5480" },
  { id: "berry", label: "Berry", from: "#d68aa8", to: "#7a3f62" },
  { id: "sand", label: "Sand", from: "#e2cfa8", to: "#a08262" },
];

const COLOR_KEY = "sorted.avatarColor";

function readColor(): AvatarColor {
  try {
    const id = localStorage.getItem(COLOR_KEY);
    return AVATAR_COLORS.find((c) => c.id === id) ?? AVATAR_COLORS[0];
  } catch {
    return AVATAR_COLORS[0];
  }
}

/** 고른 동그라미 색과 바꾸는 함수. 다른 창에서 바꿔도 따라온다. */
export function useAvatarColor(): [AvatarColor, (id: string) => void] {
  const [color, setColor] = useState(readColor);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === COLOR_KEY) setColor(readColor());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const choose = (id: string) => {
    const next = AVATAR_COLORS.find((c) => c.id === id) ?? AVATAR_COLORS[0];
    try {
      localStorage.setItem(COLOR_KEY, next.id);
    } catch {
      // 저장하지 못해도 이번 실행 동안은 바뀐다
    }
    setColor(next);
  };
  return [color, choose];
}
