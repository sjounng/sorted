import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { detail, title, type Received } from "../messages";

/** 개발용 화면: 확장에서 온 메시지를 보여 준다. 메뉴 막대 아이콘의 오른쪽 클릭 메뉴에서 연다. */
export function MessageLog() {
  const [items, setItems] = useState<Received[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isTauri()) return;

    // 새 메시지를 먼저 듣고, 그다음 지난 메시지를 가져온다. 순서를 바꾸면 사이에 온 메시지를 놓칠 수 있다.
    const seen = new Set<string>();
    const key = (r: Received) => `${r.receivedAtMs}:${JSON.stringify(r.message)}`;
    const showOnce = (r: Received) => {
      if (seen.has(key(r))) return;
      seen.add(key(r));
      setItems((prev) => [r, ...prev]);
    };

    const unlisten = listen<Received>("native-message", (event) => showOnce(event.payload));
    unlisten
      .then(() => invoke<Received[]>("received_messages"))
      .then((past) => past.forEach(showOnce))
      .catch((err) => setError(String(err)));

    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  const status = error
    ? `앱 내부 연결 오류: ${error}`
    : items.length > 0
      ? `받은 메시지 ${items.length}개`
      : "아직 받은 메시지가 없습니다. 확장 아이콘을 눌러 보세요.";

  return (
    <main className="log">
      <header>
        <h1>메시지 기록</h1>
        <p className="muted">개발용 화면: 확장에서 온 메시지를 보여 준다.</p>
      </header>
      <p className="muted">{status}</p>
      <ol className="messages">
        {items.map((item) => (
          <li
            key={`${item.receivedAtMs}:${JSON.stringify(item.message)}`}
            className={item.source === "queued" ? "queued" : undefined}
          >
            <strong>{title(item)}</strong>
            <span>{detail(item)}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
