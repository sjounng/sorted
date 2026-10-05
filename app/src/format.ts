import { language } from "./i18n";

// 날짜·시간·크기 문구. 지금 언어(#46)를 따른다.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "4m ago", "2h ago", "yesterday", "3d ago" / "방금", "4분 전", "2시간 전", "어제", "3일 전" */
export function ago(atMs: number, nowMs = Date.now()): string {
  const ko = language() === "ko";
  const diff = Math.max(0, nowMs - atMs);
  if (diff < MINUTE) return ko ? "방금" : "just now";
  if (diff < HOUR)
    return ko ? `${Math.floor(diff / MINUTE)}분 전` : `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY)
    return ko ? `${Math.floor(diff / HOUR)}시간 전` : `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return ko ? "어제" : "yesterday";
  return ko ? `${Math.floor(diff / DAY)}일 전` : `${Math.floor(diff / DAY)}d ago`;
}

/** "2.4MB" */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** 요일 이름 (일요일부터) */
export function weekdays(): string[] {
  return language() === "ko" ? WEEKDAYS_KO : WEEKDAYS;
}
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

/** "11:59 PM" / "오후 11:59" */
export function clock(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const hour = h % 12 === 0 ? 12 : h % 12;
  if (language() === "ko") return `${h < 12 ? "오전" : "오후"} ${hour}:${m}`;
  return `${hour}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "Fri, Oct 9" / "10월 9일 (금)" */
export function dateLabel(ms: number): string {
  const d = new Date(ms);
  if (language() === "ko")
    return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS_KO[d.getDay()]})`;
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "October 2026" / "2026년 10월" */
export function monthLabel(ms: number): string {
  const d = new Date(ms);
  if (language() === "ko") return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

/** 주차 이름을 화면용으로: 영어면 "2주차" → "Week 2", "미분류" → "Unsorted". 폴더 이름(데이터)은 그대로 */
export function weekLabel(week: string): string {
  if (language() === "ko") return week;
  if (week === "미분류") return "Unsorted";
  const m = /^(\d+)주차$/.exec(week);
  return m ? `Week ${m[1]}` : week;
}
