import type { Backend } from "./backend";
import { mockSchedule } from "./mockSchedule";
import { courseNameProblem } from "./validate";
import type {
  Change,
  CleanupRequest,
  Comparison,
  Course,
  CourseDetail,
  CourseFile,
  DuplicateNotice,
  Language,
  Overview,
  Settings,
  PageChange,
  PageImage,
  Region,
  SetupStatus,
  WeekGroup,
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
const now = Date.now();

// 과목별 자료. 주차 안에서는 LMS 게시 순서. 카드의 파일 수·최근 주차는 여기서 센다.
// "(v2)"가 붙은 파일은 새 버전이고, 아직 변경 비교를 열어 보지 않은 상태다.
const LIBRARY: { id: string; name: string; weeks: Record<string, string[]> }[] = [
  {
    id: "11171",
    name: "소프트웨어공학",
    weeks: {
      "1주차": ["01_강의소개.pdf", "01_소프트웨어공학개요.pdf"],
      "2주차": ["02_소프트웨어프로세스.pdf", "02_애자일과스크럼.pdf"],
      "3주차": ["03_요구사항공학.pdf", "03_유스케이스.pdf"],
      "4주차": ["04_UML.pdf", "04_설계원칙.pdf"],
      "5주차": [
        "05_아키텍처.pdf",
        "05_디자인패턴.pdf",
        "Phase1_과제명세.pdf",
        "Phase1_과제명세 (v2).pdf",
      ],
    },
  },
  {
    id: "11174",
    name: "테크노경영학(스타트업종합설계)",
    weeks: {
      "1주차": ["01_스타트업개론.pdf"],
      "2주차": ["02_고객발견.pdf", "02_린캔버스_템플릿.pdf"],
      "3주차": ["03_시장규모추정.pdf", "03_팀빌딩.pdf"],
      "4주차": ["04_MVP설계.pdf"],
      "5주차": ["05_비즈니스모델.pdf", "05_중간발표_가이드.pdf"],
    },
  },
  {
    id: "11182",
    name: "시스템감리론",
    weeks: {
      "1주차": ["01_정보시스템감리개요.pdf"],
      "2주차": ["02_감리기준과법령.pdf"],
      "3주차": ["03_감리계획수립.pdf", "03_감리체크리스트.pdf"],
      "4주차": ["04_감리절차.pdf", "04_사례연구.pdf"],
    },
  },
  {
    id: "11184",
    name: "확률과통계",
    weeks: {
      "1주차": ["01_확률의기초.pdf", "01_연습문제.pdf"],
      "2주차": ["02_순열과조합.pdf", "02_연습문제.pdf"],
      "3주차": ["03_확률변수.pdf", "03_연습문제.pdf"],
      "4주차": ["04_이산확률분포.pdf", "04_연습문제.pdf"],
      "5주차": ["05_조건부확률.pdf", "05_연습문제.pdf"],
    },
  },
  {
    id: "11190",
    name: "생활법률",
    weeks: {
      "1주차": ["01_법의기초.pdf"],
      "2주차": ["02_계약법.pdf"],
      "3주차": ["03_주택임대차.pdf", "03_판례자료.pdf"],
      "4주차": ["04_소비자보호.pdf"],
    },
  },
  {
    id: "11201",
    name: "사랑의실천2(스마트커뮤니케이션)",
    weeks: {
      "1주차": ["01_오리엔테이션.pdf"],
      "2주차": ["02_스마트커뮤니케이션.pdf"],
      "3주차": ["03_봉사활동계획서_양식.pdf"],
    },
  },
];

/** 과제 명세는 변경 비교·구버전 정리 목업과 같은 문서다 */
const SPEC_DOCUMENT = "6aa284ef1cf74";

function details(): CourseDetail[] {
  return LIBRARY.map((c) => {
    const weekNames = Object.keys(c.weeks);
    const last = weekNames.length;
    const course: Course = {
      id: c.id,
      name: c.name,
      lmsTitle: `202620HY${c.id}_${c.name}`,
      term: TERM,
      fileCount: weekNames.reduce((n, w) => n + c.weeks[w].length, 0),
      latestWeek: weekNames[last - 1],
    };
    const weeks: WeekGroup[] = weekNames.map((week, wi) => ({
      week,
      files: c.weeks[week].map((fileName, fi): CourseFile => {
        const isV2 = fileName.includes("(v2)");
        const isSpec = fileName.startsWith("Phase1_과제명세");
        // 지난 주차일수록 일주일씩 앞서 받은 것으로 둔다. 새 버전은 방금 받았다.
        const savedAtMs = isV2
          ? now - 4 * MINUTE
          : now - (last - 1 - wi) * 7 * DAY - (fi + 1) * HOUR;
        return {
          id: `${c.id}-${wi}-${fi}`,
          documentId: isSpec ? SPEC_DOCUMENT : `${c.id}-${wi}-${fi}`,
          fileName,
          path: `${SORTED}/${c.name}/${week}/${fileName}`,
          version: isV2 ? 2 : 1,
          sizeBytes: fakeSize(fileName),
          savedAtMs,
          unseenChange: isV2,
          annotated: fi === 0 && wi === last - 2,
          annotations:
            fi === 0 && wi === last - 2
              ? [1, 2].map((n) => ({
                  number: n,
                  label: null,
                  fileName: n === 1 ? fileName : fileName.replace(/\.pdf$/, ` (필기 ${n}).pdf`),
                  path: `${SORTED}/${c.name}/${week}/${fileName}`,
                  modifiedAtMs: now - n * HOUR,
                }))
              : [],
        };
      }),
    }));
    return { course, weeks };
  });
}

/** 파일 이름으로 정해지는 그럴듯한 크기 (300KB~6MB) */
function fakeSize(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 300_000 + (h % 5_700_000);
}

const library = details();
const courses = (): Course[] => library.map((d) => d.course);

/** 최근 이틀 안에 받은 자료는 "최근 변경"에 나온다. 과목 화면의 목록과 항상 맞는다. */
function recentChanges(): Change[] {
  const recent: Change[] = library.flatMap((d) =>
    d.weeks.flatMap((w) =>
      w.files
        .filter((f) => now - f.savedAtMs < 2 * DAY)
        .map((f): Change => ({
          id: `c-${f.id}`,
          kind: f.version > 1 ? "newVersion" : "organized",
          documentId: f.documentId,
          courseId: d.course.id,
          courseName: d.course.name,
          fileName: f.fileName,
          changedPages: f.version > 1 ? 4 : undefined,
          atMs: f.savedAtMs,
        })),
    ),
  );
  const duplicate: Change = {
    id: "c-dup",
    kind: "duplicate",
    documentId: "5f0e33a91c7b2",
    courseId: "11184",
    courseName: "확률과통계",
    fileName: "05_조건부확률.pdf",
    atMs: now - DAY - 3 * HOUR,
  };
  return [...recent, duplicate].sort((a, b) => b.atMs - a.atMs);
}

/** Sorted 휴지통. 되살릴 때 원래 자리와 최근 변경까지 돌려놓으려고 같이 보관한다 */
const trashed: { detail: CourseDetail; index: number; changes: Change[]; removedAtMs: number }[] =
  [];

function findTrashed(courseId: string) {
  const found = trashed.find((t) => t.detail.course.id === courseId);
  if (!found) throw new Error(`This class isn’t in the Trash: ${courseId}`);
  return found;
}

// courses와 trashCount는 overview()를 부를 때 새로 센다.
const overview: Omit<Overview, "courses" | "trashCount"> = {
  sortedFolder: SORTED,
  changes: recentChanges(),
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

function findCourse(courseId: string): CourseDetail {
  const found = library.find((d) => d.course.id === courseId);
  if (!found) throw new Error(`Class not found: ${courseId}`);
  return found;
}

/** 실제 앱도 같은 규칙으로 막는다: 폴더 이름이 되므로 비거나 겹치거나 '/'가 들어가면 안 된다 */
function checkName(name: string, exceptId?: string) {
  const problem = courseNameProblem(name, courses(), exceptId);
  if (problem) throw new Error(problem);
}

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

// 목업의 언어 설정: 이 브라우저 저장소에 두고, 다른 탭(창)에는 storage 이벤트로 알린다
const LANGUAGE_KEY = "sorted.mock.language";
function mockLanguage(): Language {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY);
    if (v === "ko" || v === "en") return v;
  } catch {
    // 저장소를 못 쓰면 브라우저 언어를 따른다
  }
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}
const settingsListeners = new Set<(settings: Settings) => void>();
const settingsChanged = () => settingsListeners.forEach((l) => l({ language: mockLanguage() }));
window.addEventListener("storage", (e) => {
  if (e.key === LANGUAGE_KEY) settingsChanged();
});

export const mockBackend: Backend = {
  settings: async () => ({ language: mockLanguage() }),
  setLanguage: async (language) => {
    try {
      localStorage.setItem(LANGUAGE_KEY, language);
    } catch {
      // 저장하지 못해도 이 창에서는 바뀐다
    }
    settingsChanged();
    return { language };
  },
  onSettingsChanged: async (callback) => {
    settingsListeners.add(callback);
    return () => settingsListeners.delete(callback);
  },

  overview: () =>
    wait(structuredClone({ ...overview, courses: courses(), trashCount: trashed.length })),
  onOverviewChanged: async (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },

  courseDetail: async (courseId) => wait(structuredClone(findCourse(courseId))),
  openFile: async (path) => log("파일 열기", path),
  openOriginal: async (documentId, version) => log("원본 열기", `${documentId} v${version}`),
  renameAnnotation: async (documentId, version, n, name) => {
    for (const d of library) {
      for (const f of d.weeks.flatMap((w) => w.files)) {
        const a = f.annotations.find((a) => a.number === n);
        if (f.documentId === documentId && f.version === version && a) {
          a.label = name.trim() || null;
        }
      }
    }
  },

  addCourse: async (name) => {
    checkName(name);
    const course: Course = {
      id: `local-${Date.now()}`,
      name: name.trim(),
      term: TERM,
      fileCount: 0,
      latestWeek: "",
    };
    library.push({ course, weeks: [] });
    log("과목 추가", course);
    changed();
    return wait(structuredClone(course));
  },
  renameCourse: async (courseId, name) => {
    const found = findCourse(courseId);
    checkName(name, courseId);
    const from = found.course.name;
    const to = name.trim();
    found.course.name = to;
    for (const w of found.weeks) {
      for (const f of w.files) f.path = f.path.replace(`${SORTED}/${from}/`, `${SORTED}/${to}/`);
    }
    for (const c of overview.changes) if (c.courseId === courseId) c.courseName = to;
    log("과목명 변경", from, "→", to);
    changed();
  },
  removeCourse: async (courseId) => {
    const found = findCourse(courseId);
    const index = library.indexOf(found);
    library.splice(index, 1);
    trashed.unshift({
      detail: found,
      index,
      changes: overview.changes.filter((c) => c.courseId === courseId),
      removedAtMs: Date.now(),
    });
    overview.changes = overview.changes.filter((c) => c.courseId !== courseId);
    log("과목을 Sorted 휴지통으로", found.course.name);
    changed();
  },

  schedule: async () => wait(mockSchedule()),
  openInBrowser: async (url) => log("브라우저로 열기", url),

  trash: async () =>
    wait(
      structuredClone(
        trashed.map((t) => ({ course: t.detail.course, removedAtMs: t.removedAtMs })),
      ),
    ),
  restoreCourse: async (courseId) => {
    const t = findTrashed(courseId);
    const problem = courseNameProblem(t.detail.course.name, courses());
    if (problem) {
      throw new Error(`${problem} Rename the existing class first.`);
    }
    trashed.splice(trashed.indexOf(t), 1);
    library.splice(Math.min(t.index, library.length), 0, t.detail);
    overview.changes = [...overview.changes, ...t.changes].sort((a, b) => b.atMs - a.atMs);
    log("과목 되살림", t.detail.course.name);
    changed();
  },
  purgeCourse: async (courseId) => {
    const t = findTrashed(courseId);
    trashed.splice(trashed.indexOf(t), 1);
    log("과목 폴더를 macOS 휴지통으로", t.detail.course.name);
    changed();
  },
  emptyTrash: async () => {
    log(
      "휴지통 비우기",
      trashed.map((t) => t.detail.course.name),
    );
    trashed.length = 0;
    changed();
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
      courses: courses(),
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
      summary: "Edited on “제출물”: added 이슈 히스토리 to the GitHub item",
      regions: [bulletRegion(2)],
    },
    { kind: "added", page: 6, summary: "New page: “중간 점검”", regions: [] },
    {
      kind: "modified",
      page: 9,
      summary: "Edited on “일정”: deadline 10월 24일 → 10월 21일",
      regions: [bulletRegion(0)],
    },
    { kind: "removed", page: 9, oldPage: 9, summary: "Old page 9 “질문” removed", regions: [] },
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
