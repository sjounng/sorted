import { useMemo, useState } from "react";
import { api, type Course, type ScheduleItem, type ScheduleKind } from "../api";
import { courseColor } from "../courseColor";
import { WEEKDAYS, ago, clock, dateLabel, dDay, daysLeft, monthLabel, startOfDay } from "../format";
import { isLateOpen, isMissed } from "../schedule";
import { useLoad } from "../useLoad";

const KIND_LABEL: Record<ScheduleKind, string> = {
  assignment: "Assignment",
  quiz: "Quiz",
  video: "Video",
  event: "Event",
};

type KindFilter = "all" | ScheduleKind;

/** 거르기 버튼은 여러 개를 고르는 것이라 복수형 (항목에 붙는 종류 표시는 단수형 그대로) */
const FILTER_LABEL: Record<KindFilter, string> = {
  all: "All",
  assignment: "Assignments",
  quiz: "Quizzes",
  video: "Videos",
  event: "Events",
};

/**
 * 일정 탭: LMS의 과제·퀴즈·영상 마감을 한곳에서 본다.
 * 왼쪽 달력에서 날을 고르면 그날 일정만, 아니면 다가오는 일정을 D-day 순으로.
 */
export function ScheduleView(props: { courses: Course[]; initialDay?: number }) {
  const { courses, initialDay } = props;
  const { data, error } = useLoad(api.schedule);
  const [month, setMonth] = useState(() => firstOfMonth(initialDay ?? Date.now()));
  const [day, setDay] = useState<number | undefined>(initialDay);
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
        No LMS schedule yet. Open the LMS in Chrome once and it will show up here.
      </p>
    );
  }

  const now = Date.now();
  const byKind = data.items.filter((i) => kind === "all" || i.kind === kind);
  const byDue = (a: ScheduleItem, b: ScheduleItem) => a.dueAtMs - b.dueAtMs;
  // 날을 고르지 않았을 때: 맨 위에 지각 인정 중(남은 기한 순), 놓친 것, 그 아래 다가오는 일정
  const lateOpen =
    day === undefined
      ? byKind
          .filter((i) => isLateOpen(i, now))
          .sort((a, b) => (a.lateUntilMs ?? 0) - (b.lateUntilMs ?? 0))
      : [];
  const missed = day === undefined ? byKind.filter((i) => isMissed(i, now)).sort(byDue) : [];
  const shown = (
    day !== undefined
      ? byKind.filter((i) => startOfDay(i.dueAtMs) === day)
      : byKind.filter((i) => i.dueAtMs >= now && (showDone || !i.done))
  ).sort(byDue);

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
                {dateLabel(day)}
                <button className="link" onClick={() => setDay(undefined)}>
                  ✕ Back to upcoming
                </button>
              </>
            ) : (
              "Upcoming"
            )}
          </h2>
          <div className="chips" role="group" aria-label="Type">
            {(["all", "assignment", "quiz", "video", "event"] as KindFilter[]).map((k) => (
              <button
                key={k}
                className={kind === k ? "chip active" : "chip"}
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
              >
                {FILTER_LABEL[k]}
              </button>
            ))}
            {day === undefined && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                />
                Show completed
              </label>
            )}
          </div>
        </header>

        {shown.length === 0 && lateOpen.length === 0 && missed.length === 0 ? (
          <p className="empty muted">
            {day !== undefined ? "Nothing on this day." : "Nothing coming up."}
          </p>
        ) : (
          <ul className="sched-rows">
            {lateOpen.length > 0 && <li className="sched-day late">Late · still open</li>}
            {lateOpen.map((item) => (
              <ScheduleRow key={item.id} item={item} now={now} {...look(item)} />
            ))}
            {missed.length > 0 && <li className="sched-day missed">Missed</li>}
            {missed.map((item) => (
              <ScheduleRow key={item.id} item={item} now={now} {...look(item)} />
            ))}
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

        <p className="sched-foot muted">Synced from the LMS {ago(data.fetchedAtMs)}.</p>
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
  const late = isLateOpen(item, now);
  const pastDue = !item.done && item.kind !== "event" && item.dueAtMs < now;
  const urgency = item.done
    ? "done"
    : late
      ? "late"
      : pastDue
        ? "missed"
        : left <= 1
          ? "urgent"
          : left <= 3
            ? "soon"
            : "later";
  const notOpenYet = item.startAtMs !== undefined && item.startAtMs > now;

  const when =
    item.kind === "event"
      ? `Starts ${clock(item.dueAtMs)}`
      : late
        ? `Late until ${dateLabel(item.lateUntilMs!)} ${clock(item.lateUntilMs!)}`
        : pastDue
          ? `Was due ${dateLabel(item.dueAtMs)} ${clock(item.dueAtMs)}`
          : notOpenYet
            ? `Opens ${dateLabel(item.startAtMs!)} ${clock(item.startAtMs!)} · due ${clock(item.dueAtMs)}`
            : `Due ${clock(item.dueAtMs)}`;

  return (
    <>
      {dayHeader && <li className="sched-day">{dayHeader}</li>}
      <li className={`sched-row ${urgency}`} style={{ "--course": color } as React.CSSProperties}>
        <span className="dday">{item.done ? "Done" : dDay(item.dueAtMs, now)}</span>
        <button
          className="sched-main"
          onClick={() => api.openInBrowser(item.url)}
          title="Open in LMS"
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

export function MonthCalendar(props: {
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
    <section className="cal" aria-label="Calendar">
      <header className="cal-head">
        <button className="cal-nav" aria-label="Previous month" onClick={() => shift(-1)}>
          ‹
        </button>
        <strong>{monthLabel(month)}</strong>
        <button className="cal-nav" aria-label="Next month" onClick={() => shift(1)}>
          ›
        </button>
        <button className="link cal-today" onClick={() => onMonth(firstOfMonth(Date.now()))}>
          Today
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
              aria-label={`${dateLabel(key)}${dayItems.length ? `, ${dayItems.length} ${dayItems.length === 1 ? "item" : "items"}` : ""}`}
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

export function firstOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** 목록의 날짜 구분: "오늘", "내일", "10월 9일 (금)" */
function dayLabel(ms: number, now: number): string {
  const n = daysLeft(ms, now);
  if (n === 0) return `Today · ${dateLabel(ms)}`;
  if (n === 1) return `Tomorrow · ${dateLabel(ms)}`;
  return dateLabel(ms);
}
