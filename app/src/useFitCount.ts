import { useEffect, useRef, useState } from "react";

/** Dashboard가 한 화면에 맞춰지는 창 크기. styles.css의 같은 미디어 쿼리와 맞춘다. */
export const DASH_FIT = "(min-width: 1080px) and (min-height: 680px)";

/**
 * 목록 칸 높이에 들어가는 항목 수. 반쯤 잘린 항목을 보이지 않으려고 칸 높이로 센다.
 * 한 화면 모드가 아니면(창이 작으면) 칸 높이가 정해지지 않으므로 fallback을 돌려준다.
 */
export function useFitCount(itemHeight: number, gap: number, fallback: number) {
  const ref = useRef<HTMLUListElement>(null);
  const [count, setCount] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia(DASH_FIT);
    const measure = () => {
      if (!media.matches) {
        setCount(fallback);
        return;
      }
      const height = el.clientHeight;
      setCount(Math.max(1, Math.floor((height + gap) / (itemHeight + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    media.addEventListener("change", measure);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", measure);
    };
  }, [itemHeight, gap, fallback]);

  return [ref, count] as const;
}
