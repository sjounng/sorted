import { useLayoutEffect, useRef, useState } from "react";
import { api, type Change, type Course, type Overview, type ScheduleItem } from "../api";
import { courseColor } from "../courseColor";
import { ago, clock, dateLabel, dDay, daysLeft } from "../format";
import { t } from "../i18n";
import { UnprocessedIcon } from "../icons";
import { isLateOpen } from "../schedule";
import { useFitCount } from "../useFitCount";
import { useLoad } from "../useLoad";
import { MonthCalendar, firstOfMonth } from "./ScheduleView";
import { SearchBox } from "./SearchBox";

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** 일정 종류 이름. 언어가 바뀌면 다시 읽도록 함수로 둔다 */
function kindLabel(kind: ScheduleItem["kind"]): string {
  switch (kind) {
    case "assignment":
      return t("Assignment", "과제");
    case "quiz":
      return t("Quiz", "퀴즈");
    case "video":
      return t("Video", "영상");
    case "event":
      return t("Event", "일정");
  }
}

function changeLabel(kind: Change["kind"]): string {
  switch (kind) {
    case "organized":
      return t("Organized", "정리됨");
    case "newVersion":
      return t("New version", "새 버전");
    case "duplicate":
      return t("Already downloaded", "이미 받은 파일");
  }
}

/**
 * 앱을 열면 처음 보이는 화면: 다가오는 마감, 최근 변경, 이번 달 일정, 달성률을 한눈에.
 * 각 카드의 "더 보기"는 해당 탭으로 보낸다.
 */
export function Dashboard(props: {
  data: Overview;
  /** 사용자가 정한 이름. 없으면 "Hello!" */
  name: string;
  onEditName: () => void;
  onOpenSchedule: (day?: number) => void;
  onOpenChanges: () => void;
  onOpenUnprocessed: () => void;
  onOpenCourse: (course: Course, color: string) => void;
}) {
  const { data, name, onEditName, onOpenSchedule, onOpenChanges, onOpenUnprocessed, onOpenCourse } =
    props;
  const schedule = useLoad(api.schedule);
  // 한 화면 모드에서는 칸 높이에 들어가는 만큼만 보여 준다 (알약 52px, 줄 46px, 간격 10px)
  const [upRef, upCount] = useFitCount(52, 10, 4);
  const [changeRef, changeCount] = useFitCount(46, 10, 4);
  const [month, setMonth] = useState(() => firstOfMonth(Date.now()));
  const nameRef = useGlyphRoom(name);

  const now = Date.now();
  const items = schedule.data?.items ?? [];
  const known = new Map(data.courses.map((c) => [c.id, c]));
  const look = (item: ScheduleItem) => {
    const course = known.get(item.courseId);
    return course
      ? { name: course.name, color: courseColor(data.courses, course.id) }
      : { name: item.courseName, color: "var(--muted)" };
  };

  // Upcoming deadlines는 이름 그대로 아직 마감 전인 것만
  const upcoming = items
    .filter((i) => !i.done && i.dueAtMs >= now)
    .sort((a, b) => a.dueAtMs - b.dueAtMs)
    .slice(0, upCount);
  // 마감은 지났지만 지각 인정 중인 것: 인사 아래 띠로 알린다 (남은 기한 순)
  const lateOpen = items
    .filter((i) => isLateOpen(i, now))
    .sort((a, b) => (a.lateUntilMs ?? 0) - (b.lateUntilMs ?? 0));
  const soon = items.filter((i) => !i.done && i.dueAtMs >= now && daysLeft(i.dueAtMs, now) <= 3);

  // 달성률: 일주일 안에 마감인 것까지 (이미 지난 것 포함)
  const dueThisWeek = items.filter((i) => i.dueAtMs <= now + WEEK);
  const rate = (pick: (i: ScheduleItem) => boolean) => {
    const all = dueThisWeek.filter(pick);
    return all.length ? { done: all.filter((i) => i.done).length, total: all.length } : undefined;
  };
  const videos = rate((i) => i.kind === "video");
  const homework = rate((i) => i.kind === "assignment" || i.kind === "quiz");
  const files = data.courses.reduce((n, c) => n + c.fileCount, 0);

  return (
    <div className="dash">
      <header className="dash-head">
        <div className="dash-greet">
          <h1>
            {t("Hello", "안녕하세요")}
            {name ? ", " : "."}
            {name && (
              <>
                <span className="greet-name" ref={nameRef}>
                  {name}
                </span>
                {t(".", " 님.")}
              </>
            )}
          </h1>
          {!name && (
            <button className="link name-cta" onClick={onEditName}>
              {t("Set your name for a proper hello ›", "인사말에 쓸 이름을 정해 주세요 ›")}
            </button>
          )}
          <p className="muted">
            {dateLabel(now)} ·{" "}
            {soon.length > 0
              ? t(
                  `${soon.length} ${soon.length === 1 ? "deadline" : "deadlines"} in the next 3 days.`,
                  `3일 안에 마감이 ${soon.length}개 있어요.`,
                )
              : t("No deadlines in the next 3 days.", "3일 안에 마감이 없어요.")}
          </p>
          {lateOpen.length > 0 && (
            <button className="late-strip" onClick={() => onOpenSchedule()}>
              <UnprocessedIcon />
              <span>
                <strong>
                  {t(`${lateOpen.length} still open late`, `지각 제출 가능 ${lateOpen.length}개`)}
                </strong>{" "}
                · {lateOpen[0].title}{" "}
                {t(
                  `until ${dateLabel(lateOpen[0].lateUntilMs!)} ${clock(lateOpen[0].lateUntilMs!)}`,
                  `${dateLabel(lateOpen[0].lateUntilMs!)} ${clock(lateOpen[0].lateUntilMs!)}까지`,
                )}
              </span>
              <span aria-hidden>›</span>
            </button>
          )}
        </div>
        <SearchBox data={data} onOpenCourse={onOpenCourse} />
      </header>

      <div className="dash-main">
        <section className="widget">
          <WidgetHead
            title={t("Upcoming deadlines", "다가오는 마감")}
            more={t("See all", "모두 보기")}
            onMore={() => onOpenSchedule()}
          />
          <ul className="up-list" ref={upRef}>
            {upcoming.length === 0 && (
              <li className="widget-empty muted">
                {t("No upcoming deadlines.", "다가오는 마감이 없어요.")}
              </li>
            )}
            {upcoming.map((item) => {
              const { name, color } = look(item);
              const left = daysLeft(item.dueAtMs, now);
              return (
                <li key={item.id}>
                  <button
                    className={`up-item ${left <= 1 ? "urgent" : left <= 3 ? "soon" : ""}`}
                    style={{ "--course": color } as React.CSSProperties}
                    onClick={() => api.openInBrowser(item.url)}
                    title={t("Open in LMS", "LMS에서 열기")}
                  >
                    <span className="up-date">
                      <strong>{new Date(item.dueAtMs).getDate()}</strong>
                      <small>{dDay(item.dueAtMs, now)}</small>
                    </span>
                    <span className="up-text">
                      <strong>{item.title}</strong>
                      <span className="muted">
                        {kindLabel(item.kind)} · {name} · {clock(item.dueAtMs)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="widget">
          <WidgetHead
            title={t("Recent changes", "최근 변경")}
            more={t("See more", "더 보기")}
            onMore={onOpenChanges}
          />
          <ul className="mini-rows" ref={changeRef}>
            {data.changes.length === 0 && (
              <li className="widget-empty muted">
                {t("No recent changes.", "최근 변경이 없어요.")}
              </li>
            )}
            {data.changes.slice(0, changeCount).map((c) => {
              const course = known.get(c.courseId);
              const color = course ? courseColor(data.courses, course.id) : "var(--muted)";
              return (
                <li key={c.id}>
                  <button
                    className="mini-row"
                    style={{ "--course": color } as React.CSSProperties}
                    onClick={() => course && onOpenCourse(course, color)}
                  >
                    <span className="course-dot" aria-hidden />
                    <span className="mini-text">
                      <strong>{c.fileName}</strong>
                      <span className="muted">
                        <span className={`tag ${c.kind}`}>{changeLabel(c.kind)}</span>
                        {c.courseName} · {ago(c.atMs)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="widget widget-wide">
          <WidgetHead
            title={t("My schedule", "내 일정")}
            more={t("Open schedule", "일정 열기")}
            onMore={() => onOpenSchedule()}
          />
          <div className="dash-cal">
            <MonthCalendar
              month={month}
              items={items}
              colorOf={(i) => look(i).color}
              onMonth={setMonth}
              onSelect={(day) => onOpenSchedule(day)}
            />
          </div>
        </section>
      </div>

      <aside className="dash-stats">
        <Ring
          title={t("Videos watched", "영상 시청")}
          value={videos}
          color="var(--ring-pink)"
          note={t("due within a week", "일주일 안 마감")}
        />
        <Ring
          title={t("Work submitted", "과제 제출")}
          value={homework}
          color="var(--ring-teal)"
          note={t("due within a week", "일주일 안 마감")}
        />
        <div className="stat-pair">
          <div className="stat-card stat-small">
            <span className="stat-title">{t("Files sorted", "정리한 파일")}</span>
            <strong className="stat-big">{files}</strong>
            <span className="stat-note">
              {t(
                `${data.courses.length} ${data.courses.length === 1 ? "class" : "classes"}`,
                `과목 ${data.courses.length}개`,
              )}
            </span>
          </div>
          {data.unprocessed.length > 0 && (
            <button className="stat-card stat-small stat-warn" onClick={onOpenUnprocessed}>
              <span className="stat-title">{t("Unsorted files", "처리 못한 파일")}</span>
              <strong className="stat-big">{data.unprocessed.length}</strong>
              <span className="stat-note">{t("Review ›", "확인하기 ›")}</span>
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

function WidgetHead(props: { title: string; more: string; onMore: () => void }) {
  return (
    <header className="widget-head">
      <h2>{props.title}</h2>
      <button className="link" onClick={props.onMore}>
        {props.more} ›
      </button>
    </header>
  );
}

/** 레퍼런스의 원형 진행률. value가 없으면 "—" */
function Ring(props: {
  title: string;
  value?: { done: number; total: number };
  color: string;
  note: string;
}) {
  const { title, value, color, note } = props;
  const pct = value ? Math.round((value.done / value.total) * 100) : 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="stat-card">
      <span className="stat-title">{title}</span>
      <svg className="stat-ring" viewBox="0 0 88 88" role="img" aria-label={`${title} ${pct}%`}>
        <circle cx="44" cy="44" r={r} className="ring-track" />
        <circle
          cx="44"
          cy="44"
          r={r}
          className="ring-value"
          style={{ stroke: color }}
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 44 44)"
        />
        <text x="44" y="49" textAnchor="middle" className="ring-text">
          {value ? `${pct}%` : "—"}
        </text>
      </svg>
      <span className="stat-note">
        {value
          ? `${value.done}/${value.total} · ${note}`
          : t("Nothing scheduled yet", "아직 일정이 없어요")}
      </span>
    </div>
  );
}

/**
 * 손글씨 글꼴은 글자 꼬리(g·f·j의 고리, 대문자 장식)가 글자 칸 밖으로 나와 앞의 쉼표·뒤의 마침표와 겹친다.
 * 첫 글자와 마지막 글자가 칸 밖으로 나온 만큼을 재서 그만큼 여백을 준다. 안 나오면 기본 여백만.
 */
function useGlyphRoom(text: string) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;

    const fit = () => {
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const chars = Array.from(text);
      const first = ctx.measureText(chars[0] ?? "");
      const last = ctx.measureText(chars[chars.length - 1] ?? "");
      const left = Math.max(0, first.actualBoundingBoxLeft);
      const right = Math.max(0, last.actualBoundingBoxRight - last.width);
      el.style.marginLeft = `${Math.max(0.14 * size, left)}px`;
      el.style.paddingRight = `${right + 0.06 * size}px`;
    };

    fit();
    // 한글 손글씨는 웹 글꼴이라 다 받은 뒤 다시 잰다. 창 크기에 따라 글자 크기도 바뀐다
    document.fonts.ready.then(fit);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [text]);

  return ref;
}
