import { useEffect, useState } from "react";
import { ago, load, type Change, type PopoverData } from "./data";

type Tab = "courses" | "changes" | "unprocessed";

/** 메뉴 막대 아이콘을 누르면 열리는 작은 창 (FR-13). */
export function Popover() {
  const [data, setData] = useState<PopoverData>();
  const [tab, setTab] = useState<Tab>("courses");

  useEffect(() => {
    load().then(setData);
  }, []);

  if (!data) return <main className="popover" />;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "courses", label: "과목" },
    { id: "changes", label: "최근 변경" },
    { id: "unprocessed", label: "처리 못한 파일", count: data.unprocessed.length },
  ];

  return (
    <main className="popover">
      <header className="popover-head">
        <h1>Sorted</h1>
      </header>

      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count ? <span className="badge">{t.count}</span> : null}
          </button>
        ))}
      </nav>

      <section className="panel" role="tabpanel">
        {tab === "courses" && <CourseList data={data} />}
        {tab === "changes" && <ChangeList data={data} />}
        {tab === "unprocessed" && <UnprocessedList data={data} />}
      </section>
    </main>
  );
}

function CourseList({ data }: { data: PopoverData }) {
  if (data.courses.length === 0) {
    return <Empty text="아직 정리한 강의자료가 없어요. LMS에서 평소처럼 받아 보세요." />;
  }
  return (
    <ul className="rows">
      {data.courses.map((c) => (
        <li key={c.id} className="row">
          <strong>{c.name}</strong>
          <span className="muted">
            파일 {c.fileCount}개 · 최근 {c.latestWeek}
          </span>
        </li>
      ))}
    </ul>
  );
}

const CHANGE_LABEL: Record<Change["kind"], (c: Change) => string> = {
  organized: () => "정리됨",
  newVersion: (c) => `새 버전 · ${c.changedPages ?? 0}장 변경`,
  duplicate: () => "이미 받은 파일",
};

function ChangeList({ data }: { data: PopoverData }) {
  if (data.changes.length === 0) return <Empty text="최근 변경이 없어요." />;
  return (
    <ul className="rows">
      {data.changes.map((c) => (
        <li key={c.id} className="row">
          <strong>{c.fileName}</strong>
          <span className="muted">
            <span className={`tag ${c.kind}`}>{CHANGE_LABEL[c.kind](c)}</span>
            {c.courseName} · {ago(c.atMs)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function UnprocessedList({ data }: { data: PopoverData }) {
  if (data.unprocessed.length === 0) return <Empty text="처리하지 못한 파일이 없어요." />;
  return (
    <>
      <p className="note muted">아래 파일은 다운로드 폴더에 그대로 두었어요.</p>
      <ul className="rows">
        {data.unprocessed.map((u) => (
          <li key={u.id} className="row">
            <strong>{u.fileName}</strong>
            <span className="muted">
              <span className="warn">{u.reason}</span> · {ago(u.atMs)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="empty muted">{text}</p>;
}
