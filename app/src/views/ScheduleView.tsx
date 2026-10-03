import { useMemo, useState } from "react";
import { api, type Course, type ScheduleItem, type ScheduleKind } from "../api";
import { courseColor } from "../courseColor";
import { ago, clockKo, dateKo, dDay, daysLeft, startOfDay } from "../format";
import { useLoad } from "../useLoad";

const KIND_LABEL: Record<ScheduleKind, string> = {
  assignment: "과제",
  quiz: "퀴즈",
  video: "영상",
  event: "일정",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

type KindFilter = "all" | ScheduleKind;

/**
 * 일정 탭: LMS의 과제·퀴즈·영상 마감을 한곳에서 본다.
 * 왼쪽 달력에서 날을 고르면 그날 일정만, 아니면 다가오는 일정을 D-day 순으로.
 */
export function ScheduleView({ courses }: { courses: Course[] }) {
  const { data, error } = useLoad(api.schedule);
  const [month, setMonth] = useState(() => firstOfMonth(Date.now()));
  const [day, setDay] = useState<number>();
  const [kind, setKind] = useState<KindFilter>("all");
  const [showDone, setShowDone] = useState(false);

  // LMS 과목이 Sorted 과목이면 그 이름·색을 쓰고, 아니면 LMS 이름에 회색
  const look = useMemo(() => {
    const known = new Map(courses.map((c) => [c.id, c]));
    return (item: ScheduleItem) => {
      const course = known.get(item.courseId);
      return course
        ? { name: course.name, color: courseColor(courses, course.id) }
        : { name: item.courseName, color: "var(--muted)" };
    };
  }, [courses]);

  if (error) return <p className="empty warn">{error}</p>;
  if (!data) return <div className="schedule" />;
  if (data.fetchedAtMs === null) {
    return (
      <p className="empty muted">
        아직 LMS 일정을 불러오지 않았어요. 크롬에서 LMS를 한 번 열면 여기에 모여요.
      </p>
    );
  }

  const now = Date.now();
  const byKind = data.items.filter((i) => kind === "all" || i.kind === kind);
  const shown = (
    day !== undefined
      ? byKind.filter((i) => startOfDay(i.dueAtMs) === day)
      : byKind.filter((i) => i.dueAtMs >= now && (showDone || !i.done))
  ).sort((a, b) => a.dueAtMs - b.dueAtMs);

  return (
    <div className="schedule">
      <MonthCalendar
        month={month}
        items={byKind}
        selected={day}
        colorOf={(i) => look(i).color}
        onMonth={setMonth}
        onSelect={(d) => setDay(d === day ? undefined : d)}
      />

      <section className="sched-list">
        <header className="sched-head">
          <h2>
            {day !== undefined ? (
              <>
                {dateKo(day)}
                <button className="link" onClick={() => setDay(undefined)}>
                  ✕ 다가오는 일정 보기
                </button>
              </>
            ) : (
              "다가오는 일정"
            )}
          </h2>
          <div className="chips" role="group" aria-label="종류">
            {(["all", "assignment", "quiz", "video", "event"] as KindFilter[]).map((k) => (
              <button
                key={k}
                className={kind === k ? "chip active" : "chip"}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {k === "all" ? "전체" : KIND_LABEL[k]}
              </button>
            ))}
            {day === undefined && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                />
                완료한 것도 보기
              </label>
            )}
          </div>
        </header>

        {shown.length === 0 ? (
          <p className="empty muted">
            {day !== undefined ? "이날은 일정이 없어요." : "다가오는 일정이 없어요."}
          </p>
        ) : (
          <ul className="sched-rows">
            {shown.map((item, i) => {
              const header =
                day === undefined &&
                (i === 0 || startOfDay(shown[i - 1].dueAtMs) !== startOfDay(item.dueAtMs));
              return (
                <ScheduleRow
                  key={item.id}
                  item={item}
                  now={now}
                  dayHeader={header ? dayLabel(item.dueAtMs, now) : undefined}
                  {...look(item)}
                />
              );
            })}
          </ul>
        )}

        <p className="sched-foot muted">LMS에서 {ago(data.fetchedAtMs)}에 불러왔어요.</p>
      </section>
    </div>
  );
}

function ScheduleRow(props: {
  item: ScheduleItem;
  name: string;
  color: string;
  now: number;
  dayHeader?: string;
}) {
  const { item, name, color, now, dayHeader } = props;
  const left = daysLeft(item.dueAtMs, now);
  const urgency = item.done ? "done" : left <= 1 ? "urgent" : left <= 3 ? "soon" : "later";
  const notOpenYet = item.startAtMs !== undefined && item.startAtMs > now;

  const when =
    item.kind === "event"
      ? `시작 ${clockKo(item.dueAtMs)}`
      : notOpenYet
        ? `${dateKo(item.startAtMs!)} ${clockKo(item.startAtMs!)}부터 시청 · 마감 ${clockKo(item.dueAtMs)}`
        : `마감 ${clockKo(item.dueAtMs)}`;

  return (
    <>
      {dayHeader && <li className="sched-day">{dayHeader}</li>}
      <li className={`sched-row ${urgency}`} style={{ "--course": color } as React.CSSProperties}>
        <span className="dday">{item.done ? "완료" : dDay(item.dueAtMs, now)}</span>
        <button
          className="sched-main"
          onClick={() => api.openInBrowser(item.url)}
          title="LMS에서 열기"
        >
          <span className="sched-title">
            <span className={`kind-tag ${item.kind}`}>{KIND_LABEL[item.kind]}</span>
            <strong>{item.title}</strong>
          </span>
          <span className="sched-meta muted">
            <span className="course-dot" aria-hidden />
            {name} · {when}
          </span>
        </button>
      </li>
    </>
  );
}

function MonthCalendar(props: {
  month: number;
  items: ScheduleItem[];
  selected?: number;
  colorOf: (item: ScheduleItem) => string;
  onMonth: (month: number) => void;
  onSelect: (day: number) => void;
}) {
  const { month, items, selected, colorOf, onMonth, onSelect } = props;
  const m = new Date(month);
  const today = startOfDay(Date.now());

  // 일요일부터 시작해 이 달을 덮는 주들
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const last = new Date(m.getFullYear(), m.getMonth() + 1, 0);
  const cellCount = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;

  const byDay = new Map<number, ScheduleItem[]>();
  for (const item of items) {
    const key = startOfDay(item.dueAtMs);
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }

  const shift = (n: number) => onMonth(new Date(m.getFullYear(), m.getMonth() + n, 1).getTime());

  return (
    <section className="cal" aria-label="달력">
      <header className="cal-head">
        <button className="cal-nav" aria-label="이전 달" onClick={() => shift(-1)}>
          ‹
        </button>
        <strong>
          {m.getFullYear()}년 {m.getMonth() + 1}월
        </strong>
        <button className="cal-nav" aria-label="다음 달" onClick={() => shift(1)}>
          ›
        </button>
        <button className="link cal-today" onClick={() => onMonth(firstOfMonth(Date.now()))}>
          오늘
        </button>
      </header>
      <div className="cal-grid">
        {WEEKDAYS.map((w, i) => (
          <span key={w} className={`cal-wd ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>
            {w}
          </span>
        ))}
        {Array.from({ length: cellCount }, (_, i) => {
          const d = new Date(gridStart);
          d.setDate(gridStart.getDate() + i);
          const key = d.getTime();
          const dayItems = byDay.get(key) ?? [];
          const open = dayItems.filter((x) => !x.done);
          const classes = [
            "cal-day",
            d.getMonth() !== m.getMonth() ? "other" : "",
            key === today ? "today" : "",
            key === selected ? "selected" : "",
          ].join(" ");
          return (
            <button
              key={key}
              className={classes}
              aria-label={`${dateKo(key)}${dayItems.length ? `, 일정 ${dayItems.length}개` : ""}`}
              aria-pressed={key === selected}
              onClick={() => onSelect(key)}
            >
              <span className="num">{d.getDate()}</span>
              <span className="cal-dots">
                {(open.length ? open : dayItems).slice(0, 3).map((x) => (
                  <span
                    key={x.id}
                    className={x.done ? "cal-dot done" : "cal-dot"}
                    style={{ background: colorOf(x) }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function firstOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** 목록의 날짜 구분: "오늘", "내일", "10월 9일 (금)" */
function dayLabel(ms: number, now: number): string {
  const n = daysLeft(ms, now);
  if (n === 0) return `오늘 · ${dateKo(ms)}`;
  if (n === 1) return `내일 · ${dateKo(ms)}`;
  return dateKo(ms);
}
