import { useEffect, useState } from "react";

/** api 호출 결과를 상태로 들고 있는다. reload()로 다시 부른다. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    load()
      .then((d) => {
        if (!alive) return;
        setData(d);
        // 앞서 실패했어도 이번에 성공하면 오류를 지운다. 안 지우면 화면이 오류 문구에 머문다.
        setError(undefined);
      })
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);

  return { data, error, reload: () => setTick((t) => t + 1) };
}
