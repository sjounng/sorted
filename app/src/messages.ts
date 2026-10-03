// 앱 본체(src-tauri/src/inbox.rs, probe.rs)가 보내는 모양.
export interface Received {
  id: number;
  receivedAtMs: number;
  source: "live" | "queued";
  message: Record<string, unknown>;
  probe: Probe | { error: string } | null;
}

export interface Probe {
  name: string;
  contentId: string | null;
  courseId: { referrer: string | null; tab: string | null; url: string | null };
  tabTitle: string | null;
  file: {
    readable: boolean;
    error: string | null;
    size: number | null;
    isPdf: boolean | null;
    sha256: string | null;
  };
  firstPage: { text: string | null; error: string | null };
  previous: {
    recordedAtMs: number;
    contentId: string | null;
    contentIdSame: boolean;
    sha256Same: boolean | null;
  } | null;
}

/** 목록 한 줄에 쓸 제목. 예: "hello · 확장 아이콘 클릭", "다운로드 · Lec03.pdf" */
export function title(item: Received): string {
  if (item.message.type === "download") {
    const name = isProbe(item.probe) ? item.probe.name : baseName(item.message.filename);
    return `다운로드 · ${name}`;
  }
  const type = typeof item.message.type === "string" ? item.message.type : "(종류 없음)";
  const reason = typeof item.message.reason === "string" ? REASONS[item.message.reason] : undefined;
  return reason ? `${type} · ${reason}` : type;
}

/** 목록 한 줄에 쓸 부가 정보. 예: "14:03:21 · 앱이 꺼져 있는 동안 보관됨" */
export function detail(item: Received, timeZone?: string): string {
  const time = clock(item.receivedAtMs, timeZone);
  return item.source === "queued" ? `${time} · 앱이 꺼져 있는 동안 보관됨` : time;
}

export type Status = "pass" | "fail" | "later" | "look";

export interface Row {
  label: string;
  status: Status;
  detail: string;
}

/**
 * 스파이크 #3의 가정 다섯 개를 다운로드 하나에 대해 판정한다.
 * pass 맞음 · fail 틀림 · later 다시 받아야 알 수 있음 · look 사람이 내용을 보고 판단
 * 아직 확인 중이면 빈 목록.
 */
export function assumptions(probe: Received["probe"], timeZone?: string): Row[] {
  if (!probe) return [];
  if (!isProbe(probe)) {
    return [{ label: "확인 실패", status: "fail", detail: probe.error }];
  }
  const { courseId, file, previous, firstPage } = probe;

  const ids = `referrer ${courseId.referrer ?? "없음"} · 탭 ${courseId.tab ?? "없음"} · URL ${courseId.url ?? "없음"}`;
  const rows: Row[] = [
    {
      label: "1. 활성 탭에서 과목 ID",
      status: courseId.tab ? "pass" : "fail",
      detail: ids,
    },
  ];

  if (!probe.contentId) {
    rows.push({ label: "2. content_id 유지", status: "fail", detail: "content_id가 없음" });
  } else if (!previous) {
    rows.push({
      label: "2. content_id 유지",
      status: "later",
      detail: `처음 받은 파일 (${probe.contentId}). 다른 날 다시 받으면 비교됨`,
    });
  } else {
    rows.push({
      label: "2. content_id 유지",
      status: previous.contentIdSame ? "pass" : "fail",
      detail: `지난번(${dateTime(previous.recordedAtMs, timeZone)}) ${previous.contentId ?? "없음"} → 이번 ${probe.contentId}`,
    });
  }

  if (!previous) {
    rows.push({ label: "3. 다시 받아도 해시 같음", status: "later", detail: "처음 받은 파일" });
  } else if (previous.sha256Same === null) {
    rows.push({
      label: "3. 다시 받아도 해시 같음",
      status: "fail",
      detail: "파일을 읽지 못해 비교 불가",
    });
  } else {
    rows.push({
      label: "3. 다시 받아도 해시 같음",
      status: previous.sha256Same ? "pass" : "fail",
      detail: previous.sha256Same ? "같음" : "다름 (LMS가 파일을 바꿨거나 새 버전)",
    });
  }

  rows.push({
    label: "4. 다운로드 폴더 읽기",
    status: file.readable ? "pass" : "fail",
    detail: file.readable
      ? `${formatSize(file.size ?? 0)} · ${file.isPdf ? "PDF" : "PDF 아님"} · ${file.sha256?.slice(0, 12)}…`
      : (file.error ?? "알 수 없는 오류"),
  });

  const seen = [
    probe.tabTitle ? `탭 제목: ${probe.tabTitle}` : "탭 제목 없음",
    firstPage.text
      ? `첫 페이지: ${firstPage.text}`
      : `첫 페이지 못 읽음 (${firstPage.error ?? "?"})`,
  ];
  rows.push({ label: "5. 과목명·주차 읽기", status: "look", detail: seen.join("\n") });

  return rows;
}

export const STATUS_TEXT: Record<Status, string> = {
  pass: "맞음",
  fail: "틀림",
  later: "나중에",
  look: "직접 확인",
};

function isProbe(p: Received["probe"]): p is Probe {
  return !!p && "file" in p;
}

function baseName(path: unknown): string {
  return typeof path === "string" ? (path.split("/").pop() ?? path) : "(이름 없음)";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

/** "10/03 14:03" 형식 */
function dateTime(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

const REASONS: Record<string, string> = {
  installed: "확장 설치",
  startup: "Chrome 시작",
  clicked: "확장 아이콘 클릭",
};
