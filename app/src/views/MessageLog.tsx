import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { STATUS_TEXT, assumptions, detail, title, type Received } from "../messages";

/**
 * 개발용 화면: 확장에서 온 메시지를 보여 준다. 앱 메뉴의 "개발 → 메시지 기록"에서 연다.
 * 다운로드는 스파이크 #3의 가정 확인 결과를 함께 보여 준다.
 */
export function MessageLog() {
  // 같은 id는 자리를 지키며 바꾸고, 새 항목은 맨 위에 넣는다. (앱이 확인 결과·정리 결과를 덧붙여 다시 보낸다)
  const [items, setItems] = useState<Received[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!isTauri()) return;

    const upsert = (item: Received) =>
      setItems((prev) => {
        const i = prev.findIndex((p) => p.id === item.id);
        if (i === -1) return [item, ...prev];
        const next = [...prev];
        next[i] = item;
        return next;
      });

    // 새 메시지를 먼저 듣고, 그다음 지난 메시지를 가져온다. 순서를 바꾸면 사이에 온 메시지를 놓칠 수 있다.
    const unlisten = listen<Received>("native-message", (event) => upsert(event.payload));
    unlisten
      .then(() => invoke<Received[]>("received_messages"))
      .then((past) =>
        setItems((prev) => {
          // 듣기 시작한 뒤 이미 더 새로운 상태로 들어온 항목은 덮어쓰지 않는다.
          const seen = new Set(prev.map((p) => p.id));
          const older = past.filter((p) => !seen.has(p.id)).reverse();
          return [...prev, ...older];
        }),
      )
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
          <li key={item.id} className={item.source === "queued" ? "queued" : undefined}>
            <strong>{title(item)}</strong>
            <span>{detail(item)}</span>
            {item.message.type === "download" && <Checks item={item} />}
          </li>
        ))}
      </ol>
    </main>
  );
}

function Checks({ item }: { item: Received }) {
  const rows = assumptions(item.probe);
  if (rows.length === 0) return <p className="pending">파일 확인 중…</p>;
  return (
    <dl className="checks">
      {rows.map((row) => (
        <Row key={row.label} label={row.label} status={row.status} detail={row.detail} />
      ))}
    </dl>
  );
}

function Row(props: { label: string; status: keyof typeof STATUS_TEXT; detail: string }) {
  return (
    <>
      <dt>{props.label}</dt>
      <dd className={`check-badge ${props.status}`}>{STATUS_TEXT[props.status]}</dd>
      <dd className="why">{props.detail}</dd>
    </>
  );
}
