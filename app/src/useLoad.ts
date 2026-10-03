import { useEffect, useState } from "react";

/** api 호출 결과를 상태로 들고 있는다. reload()로 다시 부른다. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    load()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, [...deps, tick]);

  return { data, error, reload: () => setTick((t) => t + 1) };
}
