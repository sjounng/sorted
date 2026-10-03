import { useEffect, useState } from "react";
import { api, type Change, type Overview, type UnprocessedReason } from "../api";
import { ago } from "../format";
import { useLoad } from "../useLoad";
import { openView } from "../windows";

type Tab = "courses" | "changes" | "unprocessed";

/** 메뉴 막대 아이콘을 누르면 열리는 작은 창 (FR-13). */
export function Popover() {
  const { data, error, reload } = useLoad(api.overview);
  const [tab, setTab] = useState<Tab>("courses");

  useEffect(() => {
    const off = api.onOverviewChanged(reload);
    return () => {
      off.then((stop) => stop());
    };
    // reload는 매번 새로 만들어지지만 하는 일은 같아서 한 번만 구독한다.
  }, []);

  if (error) return <p className="empty warn">{error}</p>;
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

      <footer className="popover-foot">
        <button className="link" onClick={() => api.revealInFinder(data.sortedFolder)}>
          {data.sortedFolder} 열기
        </button>
        <button className="link" onClick={() => openView("dashboard")}>
          대시보드
        </button>
        <button className="link" onClick={() => openView("setup")}>
          설정
        </button>
      </footer>
    </main>
  );
}

function CourseList({ data }: { data: Overview }) {
  if (data.courses.length === 0) {
    return <Empty text="아직 정리한 강의자료가 없어요. LMS에서 평소처럼 받아 보세요." />;
  }
  return (
    <ul className="rows">
      {data.courses.map((c) => (
        <li key={c.id}>
          <button
            className="row"
            onClick={() => api.revealInFinder(`${data.sortedFolder}/${c.name}`)}
          >
            <strong>{c.name}</strong>
            <span className="muted">
              파일 {c.fileCount}개 · 최근 {c.latestWeek}
            </span>
          </button>
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

function ChangeList({ data }: { data: Overview }) {
  if (data.changes.length === 0) return <Empty text="최근 변경이 없어요." />;
  return (
    <ul className="rows">
      {data.changes.map((c) => (
        <li key={c.id}>
          <button
            className="row"
            onClick={() =>
              c.kind === "newVersion"
                ? openView("compare", c.documentId)
                : api.revealInFinder(`${data.sortedFolder}/${c.courseName}`)
            }
          >
            <strong>{c.fileName}</strong>
            <span className="muted">
              <span className={`tag ${c.kind}`}>{CHANGE_LABEL[c.kind](c)}</span>
              {c.courseName} · {ago(c.atMs)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const REASON: Record<UnprocessedReason, string> = {
  unknownCourse: "과목을 알아내지 못했어요",
  notPdf: "PDF가 아니에요",
  loginExpired: "LMS 로그인이 만료된 것 같아요",
  moveFailed: "옮기지 못했어요. 잠시 뒤 다시 시도해요",
};

function UnprocessedList({ data }: { data: Overview }) {
  if (data.unprocessed.length === 0) return <Empty text="처리하지 못한 파일이 없어요." />;
  return (
    <>
      <p className="note muted">아래 파일은 다운로드 폴더에 그대로 두었어요.</p>
      <ul className="rows">
        {data.unprocessed.map((u) => (
          <li key={u.id}>
            <button
              className="row"
              disabled={u.reason !== "unknownCourse"}
              onClick={() => openView("assign", u.id)}
            >
              <strong>{u.fileName}</strong>
              <span className="muted">
                <span className="warn">{REASON[u.reason]}</span> · {ago(u.atMs)}
                {u.reason === "unknownCourse" && <span className="accent"> · 과목 고르기</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="empty muted">{text}</p>;
}
