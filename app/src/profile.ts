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

// 프로필 동그라미 색. 팬톤 팔레트 다섯 가지 중에서 고른다. 이름처럼 화면 저장소에 둔다.

export interface AvatarColor {
  id: string;
  label: string;
  from: string;
  to: string;
  /** 동그라미 안 이니셜 색. 밝은 색 위에서는 진한 갈색 */
  ink: string;
}

// 팬톤 팔레트: Transparent Yellow · Sceptre Red · Cerulean Blue · Potting Soil · Java Brown
// 각 색에 아주 살짝 명암만 준다 (from → to)
export const AVATAR_COLORS: AvatarColor[] = [
  {
    id: "transparent-yellow",
    label: "Transparent Yellow",
    from: "#f9f5d9",
    to: "#f5efc6",
    ink: "#4a2e27",
  },
  { id: "sceptre-red", label: "Sceptre Red", from: "#6b1c22", to: "#4d0e12", ink: "#f5efc6" },
  { id: "cerulean-blue", label: "Cerulean Blue", from: "#bccde2", to: "#a5bcd6", ink: "#231815" },
  { id: "potting-soil", label: "Potting Soil", from: "#5f3d34", to: "#4a2e27", ink: "#f5efc6" },
  { id: "java-brown", label: "Java Brown", from: "#3a2a24", to: "#231815", ink: "#f5efc6" },
];

/** 고르기 전 기본 색 */
const DEFAULT_COLOR = "cerulean-blue";

const COLOR_KEY = "sorted.avatarColor";

function fallback(): AvatarColor {
  return AVATAR_COLORS.find((c) => c.id === DEFAULT_COLOR) ?? AVATAR_COLORS[0];
}

function readColor(): AvatarColor {
  try {
    const id = localStorage.getItem(COLOR_KEY);
    return AVATAR_COLORS.find((c) => c.id === id) ?? fallback();
  } catch {
    return fallback();
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
    const next = AVATAR_COLORS.find((c) => c.id === id) ?? fallback();
    try {
      localStorage.setItem(COLOR_KEY, next.id);
    } catch {
      // 저장하지 못해도 이번 실행 동안은 바뀐다
    }
    setColor(next);
  };
  return [color, choose];
}
