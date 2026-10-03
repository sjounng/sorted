import { useState } from "react";
import { api, type Change, type Course, type Overview, type ScheduleItem } from "../api";
import { courseColor } from "../courseColor";
import { ago, clockKo, dateKo, dDay, daysLeft } from "../format";
import { useLoad } from "../useLoad";
import { MonthCalendar, firstOfMonth } from "./ScheduleView";

const WEEK = 7 * 24 * 60 * 60 * 1000;

const KIND_LABEL: Record<ScheduleItem["kind"], string> = {
  assignment: "과제",
  quiz: "퀴즈",
  video: "영상",
  event: "일정",
};

const CHANGE_LABEL: Record<Change["kind"], string> = {
  organized: "정리됨",
  newVersion: "새 버전",
  duplicate: "이미 받은 파일",
};

/**
 * 앱을 열면 처음 보이는 화면: 다가오는 마감, 최근 변경, 이번 달 일정, 달성률을 한눈에.
 * 각 카드의 "더 보기"는 해당 탭으로 보낸다.
 */
export function Dashboard(props: {
  data: Overview;
  onOpenSchedule: (day?: number) => void;
  onOpenChanges: () => void;
  onOpenUnprocessed: () => void;
  onOpenCourse: (course: Course, color: string) => void;
}) {
  const { data, onOpenSchedule, onOpenChanges, onOpenUnprocessed, onOpenCourse } = props;
  const schedule = useLoad(api.schedule);
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
    .slice(0, 4);
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
        <h1>안녕하세요!</h1>
        <p className="muted">
          {dateKo(now)} ·{" "}
          {soon.length > 0 ? `3일 안에 마감이 ${soon.length}개 있어요.` : "3일 안에 마감이 없어요."}
        </p>
      </header>

      <div className="dash-main">
        <section className="widget">
          <WidgetHead title="다가오는 마감" more="전체 일정" onMore={() => onOpenSchedule()} />
          {upcoming.length === 0 ? (
            <p className="widget-empty muted">다가오는 마감이 없어요.</p>
          ) : (
            <ul className="up-list">
              {upcoming.map((item) => {
                const { name, color } = look(item);
                const left = daysLeft(item.dueAtMs, now);
                return (
                  <li key={item.id}>
                    <button
                      className={`up-item ${left <= 1 ? "urgent" : left <= 3 ? "soon" : ""}`}
                      style={{ "--course": color } as React.CSSProperties}
                      onClick={() => api.openInBrowser(item.url)}
                      title="LMS에서 열기"
                    >
                      <span className="up-date">
                        <strong>{new Date(item.dueAtMs).getDate()}</strong>
                        <small>{dDay(item.dueAtMs, now)}</small>
                      </span>
                      <span className="up-text">
                        <strong>{item.title}</strong>
                        <span className="muted">
                          {KIND_LABEL[item.kind]} · {name} · {clockKo(item.dueAtMs)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="widget">
          <WidgetHead title="최근 변경" more="더 보기" onMore={onOpenChanges} />
          {data.changes.length === 0 ? (
            <p className="widget-empty muted">최근 변경이 없어요.</p>
          ) : (
            <ul className="mini-rows">
              {data.changes.slice(0, 4).map((c) => {
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
          )}
        </section>

        <section className="widget widget-wide">
          <WidgetHead title="내 일정" more="일정 탭에서 보기" onMore={() => onOpenSchedule()} />
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
        <Ring title="영상 시청" value={videos} color="#e0638f" note="일주일 안 마감까지" />
        <Ring title="과제·퀴즈 제출" value={homework} color="#4a9eb7" note="일주일 안 마감까지" />
        <div className="stat-card">
          <span className="stat-title">정리한 자료</span>
          <strong className="stat-big">{files}</strong>
          <span className="stat-note">{data.courses.length}과목</span>
        </div>
        {data.unprocessed.length > 0 && (
          <button className="stat-card stat-warn" onClick={onOpenUnprocessed}>
            <span className="stat-title">처리 못한 파일</span>
            <strong className="stat-big">{data.unprocessed.length}</strong>
            <span className="stat-note">눌러서 확인 ›</span>
          </button>
        )}
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
          stroke={color}
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          transform="rotate(-90 44 44)"
        />
        <text x="44" y="49" textAnchor="middle" className="ring-text">
          {value ? `${pct}%` : "—"}
        </text>
      </svg>
      <span className="stat-note">
        {value ? `${value.done}/${value.total} · ${note}` : "아직 일정이 없어요"}
      </span>
    </div>
  );
}
