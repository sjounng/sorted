const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "방금", "4분 전", "2시간 전", "어제", "3일 전" */
export function ago(atMs: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - atMs);
  if (diff < MINUTE) return "방금";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < 2 * DAY) return "어제";
  return `${Math.floor(diff / DAY)}일 전`;
}

/** "2.4MB" */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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

/** "오후 11:59" */
export function clockKo(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${m}`;
}

/** "10월 9일 (금)" */
export function dateKo(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
