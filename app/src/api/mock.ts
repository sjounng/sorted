import type { Backend } from "./backend";
import type {
  CleanupRequest,
  Comparison,
  Course,
  DuplicateNotice,
  Overview,
  PageChange,
  PageImage,
  Region,
  SetupStatus,
} from "./types";

// 목업 앱 본체. 판정 코어가 생기기 전까지 화면을 채운다.
// 상태는 이 창 안에서만 유지된다 (창마다 따로).

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SORTED = "~/Sorted";

const wait = <T>(value: T, ms = 150) => new Promise<T>((r) => setTimeout(() => r(value), ms));
const log = (...args: unknown[]) => console.info("[mock]", ...args);

const TERM = "2026년 2학기";
const course = (id: string, name: string, fileCount: number, latestWeek: string): Course => ({
  id,
  name,
  lmsTitle: `202620HY${id}_${name}`,
  term: TERM,
  fileCount,
  latestWeek,
});

const courses: Course[] = [
  course("11171", "소프트웨어공학", 12, "5주차"),
  course("11174", "테크노경영학(스타트업종합설계)", 8, "5주차"),
  course("11182", "시스템감리론", 6, "4주차"),
  course("11184", "확률과통계", 10, "5주차"),
  course("11190", "생활법률", 5, "4주차"),
  course("11201", "사랑의실천2(스마트커뮤니케이션)", 3, "3주차"),
];

const now = Date.now();

const overview: Overview = {
  sortedFolder: SORTED,
  courses,
  changes: [
    {
      id: "c1",
      kind: "newVersion",
      documentId: "6aa284ef1cf74",
      courseName: "소프트웨어공학",
      fileName: "Phase1_과제명세 (v2).pdf",
      changedPages: 4,
      atMs: now - 4 * MINUTE,
    },
    {
      id: "c2",
      kind: "organized",
      documentId: "7bc1190a2de01",
      courseName: "시스템감리론",
      fileName: "04_감리절차.pdf",
      atMs: now - 2 * HOUR,
    },
    {
      id: "c3",
      kind: "duplicate",
      documentId: "5f0e33a91c7b2",
      courseName: "확률과통계",
      fileName: "05_조건부확률.pdf",
      atMs: now - DAY - 3 * HOUR,
    },
  ],
  unprocessed: [
    { id: "u1", fileName: "original.pdf", reason: "unknownCourse", atMs: now - 30 * MINUTE },
    { id: "u2", fileName: "original (1).pdf", reason: "loginExpired", atMs: now - 3 * DAY },
  ],
};

let setup: SetupStatus = {
  downloadsAccess: "unknown",
  sortedFolder: SORTED,
  sortedFolderCreated: false,
  extensionConnected: true,
};

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

const duplicate: DuplicateNotice = {
  id: "d1",
  fileName: "05_조건부확률.pdf",
  courseName: "확률과통계",
  week: "5주차",
  existingPath: `${SORTED}/확률과통계/5주차/05_조건부확률.pdf`,
  existingSavedAtMs: now - 6 * DAY,
};

const cleanup: CleanupRequest = {
  documentId: "6aa284ef1cf74",
  fileName: "Phase1_과제명세.pdf",
  oldVersion: 1,
  oldPath: `${SORTED}/소프트웨어공학/5주차/Phase1_과제명세.pdf`,
  sizeBytes: 2_480_000,
  hasAnnotations: true,
};

export const mockBackend: Backend = {
  overview: () => wait(structuredClone(overview)),
  onOverviewChanged: async (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },

  setupStatus: () => wait({ ...setup }),
  requestDownloadsAccess: async () => {
    setup = { ...setup, downloadsAccess: "granted", sortedFolderCreated: true };
    return wait({ ...setup }, 600);
  },
  openSystemSettings: async () => log("시스템 설정 열기"),
  revealInFinder: async (path) => log("Finder에서 보기", path),

  assignRequest: (fileId) =>
    wait({
      fileId,
      fileName: overview.unprocessed.find((u) => u.id === fileId)?.fileName ?? "original.pdf",
      tabTitle: "202620HY11190_생활법률",
      atMs: now - 30 * MINUTE,
      courses,
    }),
  assignCourse: async (fileId, choice) => {
    log("과목 지정", fileId, choice);
    overview.unprocessed = overview.unprocessed.filter((u) => u.id !== fileId);
    changed();
  },
  skipAssign: async (fileId) => log("과목 지정 건너뜀", fileId),

  duplicateNotice: (id) => wait({ ...duplicate, id }),
  resolveDuplicate: async (id, choice) => log("중복 처리", id, choice),

  comparison: (documentId) => wait(mockComparison(documentId)),

  cleanupRequest: (documentId) => wait({ ...cleanup, documentId }),
  resolveCleanup: async (documentId, choice) => log("구버전 정리", documentId, choice),
};

// ---- 변경 비교용 가짜 슬라이드 ----
// 실제 앱은 PDF 페이지를 이미지로 만들어 넘긴다. 목업은 같은 자리에 SVG 이미지를 넣는다.

const W = 1600;
const H = 900;

const slides: { title: string; bullets: string[] }[] = [
  { title: "Phase 1 과제 명세", bullets: ["CSE406 소프트웨어공학", "2026년 2학기"] },
  { title: "목표", bullets: ["스크래치 프로젝트로 SW 공학 전 과정 경험", "중간고사 대체"] },
  {
    title: "제출물",
    bullets: ["요구사항 명세 (영어)", "설계 문서와 아키텍처 그림", "GitHub 저장소 링크"],
  },
  { title: "팀 구성", bullets: ["2인 1팀", "역할 분담을 문서에 명시"] },
  { title: "평가 기준", bullets: ["요구사항 30%", "설계 30%", "구현과 시연 40%"] },
  {
    title: "시연 방식",
    bullets: ["교수님과 3분 1:1 시연", "슬라이드 없이 노트북으로", "실제 동작 위주"],
  },
  { title: "git 사용 규칙", bullets: ["이슈 → 브랜치 → PR", "커밋 메시지에 이슈 번호"] },
  { title: "일정", bullets: ["제출 마감: 10월 24일 23:59", "시연: 10월 27일~31일"] },
  { title: "질문", bullets: ["LMS 게시판에 남겨 주세요"] },
];

const bulletTop = (i: number) => 300 + i * 120;
const bulletRegion = (i: number): Region => ({
  x: 100 / W,
  y: (bulletTop(i) - 70) / H,
  w: 1400 / W,
  h: 100 / H,
});

function slideImage(page: number, title: string, bullets: string[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const items = bullets
    .map(
      (b, i) =>
        `<circle cx="150" cy="${bulletTop(i) - 18}" r="9" fill="#1d4ed8"/>` +
        `<text x="190" y="${bulletTop(i)}" font-size="52" fill="#222">${esc(b)}</text>`,
    )
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>` +
    `<rect width="${W}" height="14" fill="#1d4ed8"/>` +
    `<text x="120" y="190" font-size="76" font-weight="700" fill="#111">${esc(title)}</text>` +
    `<line x1="120" y1="230" x2="1480" y2="230" stroke="#ddd" stroke-width="3"/>` +
    items +
    `<text x="1480" y="860" font-size="32" fill="#999" text-anchor="end">${page}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mockComparison(documentId: string): Comparison {
  // v2: 3장 제출물에 항목 추가, 6장 "중간 점검" 새로 추가, v1의 "질문" 장 삭제, 일정 마감일 수정
  const v2 = slides.slice(0, 8).map((s) => ({ ...s, bullets: [...s.bullets] }));
  v2[2].bullets[2] = "GitHub 저장소 링크와 이슈 히스토리";
  v2.splice(5, 0, {
    title: "중간 점검 (추가)",
    bullets: ["10월 17일 진행 상황 공유", "이슈 보드 캡처 제출"],
  });
  v2[8].bullets[0] = "제출 마감: 10월 21일 23:59";

  const pages: PageImage[] = v2.map((s, i) => ({
    page: i + 1,
    imageUrl: slideImage(i + 1, s.title, s.bullets),
  }));

  const changes: PageChange[] = [
    {
      kind: "modified",
      page: 3,
      summary: "제출물: GitHub 저장소 항목에 이슈 히스토리 추가",
      regions: [bulletRegion(2)],
    },
    { kind: "added", page: 6, summary: "새 장: 중간 점검", regions: [] },
    {
      kind: "modified",
      page: 9,
      summary: "일정: 제출 마감 10월 24일 → 10월 21일",
      regions: [bulletRegion(0)],
    },
    { kind: "removed", page: 9, oldPage: 9, summary: "이전 9장 '질문' 삭제", regions: [] },
  ];

  return {
    documentId,
    fileName: "Phase1_과제명세 (v2).pdf",
    courseName: "소프트웨어공학",
    oldVersion: 1,
    newVersion: 2,
    pages,
    changes,
  };
}
