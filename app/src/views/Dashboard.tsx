import { useState } from "react";
import { api, type Change, type Course, type Overview, type ScheduleItem } from "../api";
import { courseColor } from "../courseColor";
import { ago, clock, dateLabel, dDay, daysLeft } from "../format";
import { useFitCount } from "../useFitCount";
import { useLoad } from "../useLoad";
import { MonthCalendar, firstOfMonth } from "./ScheduleView";
import { SearchBox } from "./SearchBox";

const WEEK = 7 * 24 * 60 * 60 * 1000;

const KIND_LABEL: Record<ScheduleItem["kind"], string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  video: "Video",
  event: "Event",
};

const CHANGE_LABEL: Record<Change["kind"], string> = {
  organized: "Organized",
  newVersion: "New version",
  duplicate: "Already downloaded",
};

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

  const now = Date.now();
  const items = schedule.data?.items ?? [];
  const known = new Map(data.courses.map((c) => [c.id, c]));
  const look = (item: ScheduleItem) => {
    const course = known.get(item.courseId);
    return course
      ? { name: course.name, color: courseColor(data.courses, course.id) }
      : { name: item.courseName, color: "var(--muted)" };
  };

  const upcoming = items
    .filter((i) => !i.done && i.dueAtMs >= now)
    .sort((a, b) => a.dueAtMs - b.dueAtMs)
    .slice(0, upCount);
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
            Hello{name ? ", " : "!"}
            {name && (
              <>
                <span className="greet-name">{name}</span>!
              </>
            )}
          </h1>
          {!name && (
            <button className="link name-cta" onClick={onEditName}>
              Set your name for a proper hello ›
            </button>
          )}
          <p className="muted">
            {dateLabel(now)} ·{" "}
            {soon.length > 0
              ? `${soon.length} ${soon.length === 1 ? "deadline" : "deadlines"} in the next 3 days.`
              : "No deadlines in the next 3 days."}
          </p>
        </div>
        <SearchBox data={data} onOpenCourse={onOpenCourse} />
      </header>

      <div className="dash-main">
        <section className="widget">
          <WidgetHead title="Upcoming deadlines" more="See all" onMore={() => onOpenSchedule()} />
          <ul className="up-list" ref={upRef}>
            {upcoming.length === 0 && (
              <li className="widget-empty muted">No upcoming deadlines.</li>
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
                    title="Open in LMS"
                  >
                    <span className="up-date">
                      <strong>{new Date(item.dueAtMs).getDate()}</strong>
                      <small>{dDay(item.dueAtMs, now)}</small>
                    </span>
                    <span className="up-text">
                      <strong>{item.title}</strong>
                      <span className="muted">
                        {KIND_LABEL[item.kind]} · {name} · {clock(item.dueAtMs)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="widget">
          <WidgetHead title="Recent changes" more="See more" onMore={onOpenChanges} />
          <ul className="mini-rows" ref={changeRef}>
            {data.changes.length === 0 && (
              <li className="widget-empty muted">No recent changes.</li>
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
                        <span className={`tag ${c.kind}`}>{CHANGE_LABEL[c.kind]}</span>
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
          <WidgetHead title="My schedule" more="Open schedule" onMore={() => onOpenSchedule()} />
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
          title="Videos watched"
          value={videos}
          color="var(--ring-pink)"
          note="due within a week"
        />
        <Ring
          title="Work submitted"
          value={homework}
          color="var(--ring-teal)"
          note="due within a week"
        />
        <div className="stat-pair">
          <div className="stat-card stat-small">
            <span className="stat-title">Files sorted</span>
            <strong className="stat-big">{files}</strong>
            <span className="stat-note">
              {data.courses.length} {data.courses.length === 1 ? "class" : "classes"}
            </span>
          </div>
          {data.unprocessed.length > 0 && (
            <button className="stat-card stat-small stat-warn" onClick={onOpenUnprocessed}>
              <span className="stat-title">Unsorted files</span>
              <strong className="stat-big">{data.unprocessed.length}</strong>
              <span className="stat-note">Review ›</span>
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
        {value ? `${value.done}/${value.total} · ${note}` : "Nothing scheduled yet"}
      </span>
    </div>
  );
}
