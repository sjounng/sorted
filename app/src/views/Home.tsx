import { useEffect, useRef, useState } from "react";
import { api, type Course, type Overview, type UnprocessedReason } from "../api";
import { ago } from "../format";
import {
  ChangesIcon,
  ClassesIcon,
  DashboardIcon,
  FolderIcon,
  ScheduleIcon,
  SettingsIcon,
  TrashIcon,
  UnprocessedIcon,
} from "../icons";
import { initial, useDisplayName } from "../profile";
import { useLoad } from "../useLoad";
import { openView } from "../windows";
import { ChangesByCourse } from "./ChangesByCourse";
import { CourseCards } from "./CourseCards";
import { CourseDetail } from "./CourseDetail";
import { Dashboard } from "./Dashboard";
import { ScheduleView } from "./ScheduleView";
import { TrashView } from "./TrashView";

type Tab = "dashboard" | "classes" | "schedule" | "changes" | "unprocessed" | "trash";

interface NavItem {
  id: Tab;
  label: string;
  icon: () => React.JSX.Element;
  count?: number;
}

/** 메인 창: 왼쪽 사이드바 + 오른쪽 화면 (FR-13). 열면 Dashboard부터. */
export function Home() {
  const { data, error, reload } = useLoad(api.overview);
  const [tab, setTab] = useState<Tab>("dashboard");
  // 과목 카드를 누르면 My Classes 안에서 그 과목 화면으로 들어간다.
  const [opened, setOpened] = useState<{ course: Course; color: string }>();
  // 대시보드 달력에서 고른 날로 일정 탭을 연다.
  const [scheduleDay, setScheduleDay] = useState<number>();
  const panel = useRef<HTMLElement>(null);
  const [name, setName] = useDisplayName();
  const [editingName, setEditingName] = useState(false);

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
  if (!data) return <main className="home" />;

  const go = (next: Tab) => {
    setTab(next);
    setOpened(undefined);
    setScheduleDay(undefined);
  };
  const openCourse = (course: Course, color: string) => {
    go("classes");
    setOpened({ course, color });
  };

  const main: NavItem[] = [
    { id: "dashboard", label: "Dashboard", icon: DashboardIcon },
    { id: "classes", label: "My Classes", icon: ClassesIcon },
    { id: "schedule", label: "Schedule", icon: ScheduleIcon },
    { id: "changes", label: "Recent Changes", icon: ChangesIcon },
    {
      id: "unprocessed",
      label: "Unsorted Files",
      icon: UnprocessedIcon,
      count: data.unprocessed.length,
    },
  ];

  return (
    <main className="home">
      <nav className="side-nav" aria-label="Menu">
        <div className="brand-logo" aria-label="Sorted">
          <span className="brand-mark" aria-hidden>
            S
          </span>
          <span className="brand-text" aria-hidden>
            Sorted
          </span>
        </div>

        {editingName ? (
          <NameEditor
            initial={name}
            onDone={(next) => {
              if (next !== undefined) setName(next);
              setEditingName(false);
            }}
          />
        ) : (
          <button
            className="profile"
            title="Change name"
            aria-label={name ? `${name}, change name` : "Set your name"}
            onClick={() => setEditingName(true)}
          >
            <span className="avatar" aria-hidden>
              {initial(name)}
            </span>
            <span className="profile-name">
              {name || "Set your name"}
              <small>{name ? "Change name" : "for your greeting"}</small>
            </span>
          </button>
        )}

        <ul className="nav-list" role="tablist" aria-orientation="vertical">
          {main.map((item) => (
            <NavButton key={item.id} item={item} active={tab === item.id} onClick={go} />
          ))}
        </ul>

        <ul className="nav-list nav-bottom">
          <NavButton
            item={{ id: "trash", label: "Trash", icon: TrashIcon, count: data.trashCount }}
            active={tab === "trash"}
            quietCount
            onClick={go}
          />
          <li>
            <button
              className="nav-item"
              title={`Open ${data.sortedFolder}`}
              onClick={() => api.revealInFinder(data.sortedFolder)}
            >
              <FolderIcon />
              <span className="nav-label">Open Folder</span>
            </button>
          </li>
          <li>
            <button className="nav-item" title="Settings" onClick={() => openView("setup")}>
              <SettingsIcon />
              <span className="nav-label">Settings</span>
            </button>
          </li>
        </ul>
      </nav>

      <section
        className={tab === "dashboard" ? "panel panel-dash" : "panel"}
        role="tabpanel"
        ref={panel}
      >
        {tab === "dashboard" && (
          <Dashboard
            data={data}
            name={name}
            onEditName={() => setEditingName(true)}
            onOpenSchedule={(day) => {
              go("schedule");
              setScheduleDay(day);
            }}
            onOpenChanges={() => go("changes")}
            onOpenUnprocessed={() => go("unprocessed")}
            onOpenCourse={openCourse}
          />
        )}
        {tab === "classes" &&
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
        {tab === "schedule" && (
          <ScheduleView
            key={scheduleDay ?? "upcoming"}
            courses={data.courses}
            initialDay={scheduleDay}
          />
        )}
        {tab === "changes" && <ChangesByCourse data={data} onOpenCourse={openCourse} />}
        {tab === "unprocessed" && <UnprocessedList data={data} />}
        {tab === "trash" && <TrashView />}
      </section>
    </main>
  );
}

/** 사이드바의 이름 입력: Enter 저장, Esc 취소 */
function NameEditor(props: { initial: string; onDone: (name?: string) => void }) {
  const [value, setValue] = useState(props.initial);
  return (
    <form
      className="profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        props.onDone(value);
      }}
    >
      <input
        className="text"
        autoFocus
        maxLength={20}
        placeholder="Your name"
        aria-label="Name for your greeting"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && props.onDone()}
        onBlur={() => props.onDone(value)}
        onFocus={(e) => e.target.select()}
      />
      <p className="field-hint muted">Enter to save · Esc to cancel</p>
    </form>
  );
}

function NavButton(props: {
  item: NavItem;
  active: boolean;
  /** 휴지통처럼 경고가 아닌 개수는 회색으로 */
  quietCount?: boolean;
  onClick: (tab: Tab) => void;
}) {
  const { item, active, quietCount, onClick } = props;
  const Icon = item.icon;
  return (
    <li>
      <button
        role="tab"
        aria-selected={active}
        className={active ? "nav-item active" : "nav-item"}
        title={item.label}
        onClick={() => onClick(item.id)}
      >
        <Icon />
        <span className="nav-label">{item.label}</span>
        {item.count ? (
          <span className={quietCount ? "nav-count quiet" : "nav-count"}>{item.count}</span>
        ) : null}
      </button>
    </li>
  );
}

const REASON: Record<UnprocessedReason, string> = {
  unknownCourse: "Couldn’t tell which class",
  notPdf: "Not a PDF",
  loginExpired: "LMS login seems to have expired",
  moveFailed: "Couldn’t move it. Will retry soon",
};

function UnprocessedList({ data }: { data: Overview }) {
  if (data.unprocessed.length === 0) return <Empty text="No unsorted files." />;
  return (
    <>
      <p className="note muted">These files are still in your Downloads folder.</p>
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
                {u.reason === "unknownCourse" && <span className="accent"> · Choose a class</span>}
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
