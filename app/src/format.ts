const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "4m ago", "2h ago", "yesterday", "3d ago" */
export function ago(atMs: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - atMs);
  if (diff < MINUTE) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return "yesterday";
  return `${Math.floor(diff / DAY)}d ago`;
}

/** "2.4MB" */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** 그날 0시 (이 컴퓨터 시간대) */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 날짜로 센 남은 날. 오늘이면 0, 어제면 -1 (시각은 보지 않는다) */
export function daysLeft(ms: number, nowMs = Date.now()): number {
  return Math.round((startOfDay(ms) - startOfDay(nowMs)) / DAY);
}

/** "D-day", "D-3", "D+2" */
export function dDay(ms: number, nowMs = Date.now()): string {
  const n = daysLeft(ms, nowMs);
  if (n === 0) return "D-day";
  return n > 0 ? `D-${n}` : `D+${-n}`;
}

/** "11:59 PM" */
export function clock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "Fri, Oct 9" */
export function dateLabel(ms: number): string {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "October 2026" */
export function monthLabel(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}
