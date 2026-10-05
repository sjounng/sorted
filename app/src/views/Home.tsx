import { useEffect, useRef, useState } from "react";
import { api, type Course, type Overview, type UnprocessedReason } from "../api";
import { ago } from "../format";
import { t } from "../i18n";
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
import { AVATAR_COLORS, initial, useAvatarColor, useDisplayName } from "../profile";
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
    { id: "dashboard", label: t("Dashboard", "대시보드"), icon: DashboardIcon },
    { id: "classes", label: t("My Classes", "내 과목"), icon: ClassesIcon },
    { id: "schedule", label: t("Schedule", "일정"), icon: ScheduleIcon },
    { id: "changes", label: t("Recent Changes", "최근 변경"), icon: ChangesIcon },
    {
      id: "unprocessed",
      label: t("Unsorted Files", "처리 못한 파일"),
      icon: UnprocessedIcon,
      count: data.unprocessed.length,
    },
  ];

  return (
    <main className="home">
      <nav className="side-nav" aria-label={t("Menu", "메뉴")}>
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
          <Profile name={name} onEditName={() => setEditingName(true)} />
        )}

        <ul className="nav-list" role="tablist" aria-orientation="vertical">
          {main.map((item) => (
            <NavButton key={item.id} item={item} active={tab === item.id} onClick={go} />
          ))}
        </ul>

        <ul className="nav-list nav-bottom">
          <NavButton
            item={{
              id: "trash",
              label: t("Trash", "휴지통"),
              icon: TrashIcon,
              count: data.trashCount,
            }}
            active={tab === "trash"}
            quietCount
            onClick={go}
          />
          <li>
            <button
              className="nav-item"
              title={t(`Open ${data.sortedFolder}`, `${data.sortedFolder} 열기`)}
              onClick={() => api.revealInFinder(data.sortedFolder)}
            >
              <FolderIcon />
              <span className="nav-label">{t("Open Folder", "폴더 열기")}</span>
            </button>
          </li>
          <li>
            <button
              className="nav-item"
              title={t("Settings", "설정")}
              onClick={() => openView("setup")}
            >
              <SettingsIcon />
              <span className="nav-label">{t("Settings", "설정")}</span>
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

/**
 * 사이드바 프로필: 동그라미를 누르면 색 고르기, 이름을 누르면 이름 바꾸기.
 * 색 고르는 창은 바깥을 누르거나 Esc로 닫힌다.
 */
function Profile({ name, onEditName }: { name: string; onEditName: () => void }) {
  const [color, chooseColor] = useAvatarColor();
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!picking) return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      ) {
        setPicking(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [picking]);

  return (
    <div className="profile" ref={box}>
      <button
        className="avatar-btn"
        title={t("Change color", "색 바꾸기")}
        aria-label={t("Change avatar color", "프로필 색 바꾸기")}
        aria-expanded={picking}
        onClick={() => setPicking((p) => !p)}
      >
        <span
          className="avatar"
          aria-hidden
          style={
            {
              "--avatar-from": color.from,
              "--avatar-to": color.to,
              "--avatar-ink": color.ink,
            } as React.CSSProperties
          }
        >
          {initial(name)}
        </span>
      </button>
      <button
        className="profile-name"
        title={t("Change name", "이름 바꾸기")}
        aria-label={
          name
            ? t(`${name}, change name`, `${name}, 이름 바꾸기`)
            : t("Set your name", "이름 정하기")
        }
        onClick={onEditName}
      >
        {name || t("Set your name", "이름 정하기")}
        <small>
          {name ? t("Change name", "이름 바꾸기") : t("for your greeting", "인사말에 쓸 이름")}
        </small>
      </button>

      {picking && (
        <div
          className="avatar-picker"
          role="radiogroup"
          aria-label={t("Avatar color", "프로필 색")}
        >
          {AVATAR_COLORS.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={c.id === color.id}
              aria-label={c.label}
              title={c.label}
              className={c.id === color.id ? "swatch selected" : "swatch"}
              style={{ "--avatar-from": c.from, "--avatar-to": c.to } as React.CSSProperties}
              onClick={() => {
                chooseColor(c.id);
                setPicking(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
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
        placeholder={t("Your name", "이름")}
        aria-label={t("Name for your greeting", "인사말에 쓸 이름")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && props.onDone()}
        onBlur={() => props.onDone(value)}
        onFocus={(e) => e.target.select()}
      />
      <p className="field-hint muted">
        {t("Enter to save · Esc to cancel", "Enter 저장 · Esc 취소")}
      </p>
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

/** 처리하지 못한 이유. 언어가 바뀌면 다시 읽도록 함수로 둔다 */
function reason(r: UnprocessedReason): string {
  switch (r) {
    case "unknownCourse":
      return t("Couldn’t tell which class", "과목을 알아내지 못했어요");
    case "notPdf":
      return t("Not a PDF", "PDF가 아니에요");
    case "loginExpired":
      return t("LMS login seems to have expired", "LMS 로그인이 만료된 것 같아요");
    case "moveFailed":
      return t("Couldn’t move it. Will retry soon", "옮기지 못했어요. 잠시 뒤 다시 시도해요");
  }
}

function UnprocessedList({ data }: { data: Overview }) {
  if (data.unprocessed.length === 0)
    return <Empty text={t("No unsorted files.", "처리하지 못한 파일이 없어요.")} />;
  return (
    <>
      <p className="note muted">
        {t(
          "These files are still in your Downloads folder.",
          "아래 파일은 다운로드 폴더에 그대로 있어요.",
        )}
      </p>
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
                <span className="warn">{reason(u.reason)}</span> · {ago(u.atMs)}
                {u.reason === "unknownCourse" && (
                  <span className="accent"> · {t("Choose a class", "과목 고르기")}</span>
                )}
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
