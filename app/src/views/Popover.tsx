import { useEffect, useRef, useState } from "react";
import { api, type Change, type Course, type Overview, type UnprocessedReason } from "../api";
import { ago } from "../format";
import { useLoad } from "../useLoad";
import { openView } from "../windows";
import { CourseCards } from "./CourseCards";
import { CourseDetail } from "./CourseDetail";

type Tab = "courses" | "changes" | "unprocessed";

/** 메뉴 막대 아이콘을 누르면 열리는 작은 창 (FR-13). */
export function Popover() {
  const { data, error, reload } = useLoad(api.overview);
  const [tab, setTab] = useState<Tab>("courses");
  // 과목 카드를 누르면 과목 탭 안에서 그 과목 화면으로 들어간다.
  const [opened, setOpened] = useState<{ course: Course; color: string }>();
  const panel = useRef<HTMLElement>(null);

  // 들어가고 나올 때 목록 맨 위에서 시작한다.
  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [opened]);

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
            onClick={() => {
              setTab(t.id);
              setOpened(undefined);
            }}
          >
            {t.label}
            {t.count ? <span className="badge">{t.count}</span> : null}
          </button>
        ))}
      </nav>

      <section className="panel" role="tabpanel" ref={panel}>
        {tab === "courses" &&
          (opened ? (
            <CourseDetail
              courseId={opened.course.id}
              folder={`${data.sortedFolder}/${opened.course.name}`}
              color={opened.color}
              onBack={() => setOpened(undefined)}
            />
          ) : (
            <CourseCards data={data} onSelect={(course, color) => setOpened({ course, color })} />
          ))}
        {tab === "changes" && <ChangeList data={data} />}
        {tab === "unprocessed" && <UnprocessedList data={data} />}
      </section>

      <footer className="popover-foot">
        <button className="link" onClick={() => api.revealInFinder(data.sortedFolder)}>
          {data.sortedFolder} 열기
        </button>
        <button className="link" onClick={() => openView("setup")}>
          설정
        </button>
      </footer>
    </main>
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
