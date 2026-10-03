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
