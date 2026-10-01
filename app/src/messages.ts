// 앱 본체(src-tauri/src/inbox.rs)의 Received와 같은 모양.
export interface Received {
  receivedAtMs: number;
  source: "live" | "queued";
  message: Record<string, unknown>;
}

/** 목록 한 줄에 쓸 제목. 예: "hello · 확장 아이콘 클릭" */
export function title(item: Received): string {
  const type = typeof item.message.type === "string" ? item.message.type : "(종류 없음)";
  const reason = typeof item.message.reason === "string" ? REASONS[item.message.reason] : undefined;
  return reason ? `${type} · ${reason}` : type;
}

/** 목록 한 줄에 쓸 부가 정보. 예: "14:03:21 · 앱이 꺼져 있는 동안 보관됨" */
export function detail(item: Received, timeZone?: string): string {
  const time = clock(item.receivedAtMs, timeZone);
  return item.source === "queued" ? `${time} · 앱이 꺼져 있는 동안 보관됨` : time;
}

/** "14:03:21" 형식. 로케일마다 표기가 달라지지 않게 직접 조립한다. */
function clock(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}:${get("second")}`;
}

const REASONS: Record<string, string> = {
  installed: "확장 설치",
  startup: "Chrome 시작",
  clicked: "확장 아이콘 클릭",
};
