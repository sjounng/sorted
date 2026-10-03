import { useEffect, useRef, useState } from "react";
import { api, type Course, type Overview, type UnprocessedReason } from "../api";
import { ago } from "../format";
import { useLoad } from "../useLoad";
import { openView } from "../windows";
import { ChangesByCourse } from "./ChangesByCourse";
import { CourseCards } from "./CourseCards";
import { CourseDetail } from "./CourseDetail";
import { TrashView } from "./TrashView";

type Tab = "courses" | "changes" | "unprocessed" | "trash";

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
  }, [opened, tab]);

  useEffect(() => {
    // 구독마다 새 함수를 넘긴다. 같은 함수를 넘기면 StrictMode의 구독→해제→재구독에서
    // 늦게 도착한 해제가 재구독까지 지워 버린다.
    const off = api.onOverviewChanged(() => reload());
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
        <button
          role="tab"
          aria-selected={tab === "trash"}
          aria-label={`휴지통${data.trashCount ? ` ${data.trashCount}개` : ""}`}
          title="휴지통"
          className={tab === "trash" ? "tab tab-icon active" : "tab tab-icon"}
          onClick={() => {
            setTab("trash");
            setOpened(undefined);
          }}
        >
          <TrashIcon />
          {data.trashCount > 0 && <span className="badge corner">{data.trashCount}</span>}
        </button>
      </nav>

      <section className="panel" role="tabpanel" ref={panel}>
        {tab === "trash" && <TrashView />}
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
        {tab === "changes" && (
          <ChangesByCourse
            data={data}
            onOpenCourse={(course, color) => {
              setTab("courses");
              setOpened({ course, color });
            }}
          />
        )}
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

function TrashIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}
