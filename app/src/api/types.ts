// 화면과 앱 본체(Rust) 사이에 오가는 데이터 모양.
// Rust 쪽 구조체는 #[serde(rename_all = "camelCase")]로 이 모양에 맞춘다.

export interface Course {
  /** LMS 과목 ID (courses/<ID>). 사용자가 직접 추가한 과목은 앱이 정한 ID */
  id: string;
  /** 폴더 이름으로 쓰는 과목명. 사용자가 바꿀 수 있다. 예: "소프트웨어공학" */
  name: string;
  /** LMS 탭 제목에서 읽은 원래 이름. 직접 추가한 과목은 없다. 예: "202620HY11171_소프트웨어공학" */
  lmsTitle?: string;
  /** 예: "2026년 2학기" */
  term: string;
  /** 과목 폴더 안의 PDF 수 */
  fileCount: number;
  /** 가장 최근에 받은 자료의 주차. 예: "5주차". 자료가 없으면 빈 문자열 */
  latestWeek: string;
}

/** 정리 폴더에 있는 강의자료 하나 */
export interface CourseFile {
  id: string;
  /** 같은 문서의 버전들은 documentId가 같다 (content_id) */
  documentId: string;
  fileName: string;
  path: string;
  /** 1이면 처음 받은 그대로. 새 버전이면 2, 3, … */
  version: number;
  sizeBytes: number;
  savedAtMs: number;
  /** 새 버전이 왔는데 아직 변경 비교를 열어 보지 않았다 */
  unseenChange: boolean;
}

export interface WeekGroup {
  /** 예: "5주차", "미분류" */
  week: string;
  /** LMS 게시 순서 */
  files: CourseFile[];
}

/** 과목 하나의 자료 전체. 주차는 LMS 순서대로 1주차부터 */
export interface CourseDetail {
  course: Course;
  weeks: WeekGroup[];
}

export type ChangeKind = "organized" | "newVersion" | "duplicate";

/** 메뉴 막대의 "최근 변경" 한 줄 */
export interface Change {
  id: string;
  kind: ChangeKind;
  documentId: string;
  courseId: string;
  courseName: string;
  fileName: string;
  /** kind가 newVersion일 때 바뀐 장 수 */
  changedPages?: number;
  atMs: number;
}

export type UnprocessedReason = "unknownCourse" | "notPdf" | "loginExpired" | "moveFailed";

/** 판정하지 못해 다운로드 폴더에 그대로 둔 파일 */
export interface Unprocessed {
  id: string;
  fileName: string;
  reason: UnprocessedReason;
  atMs: number;
}

/** Sorted 휴지통에 있는 과목. 되살리면 자료·최근 변경과 함께 돌아온다 */
export interface TrashedCourse {
  course: Course;
  removedAtMs: number;
}

/** 메뉴 막대 팝오버 전체 (FR-13) */
export interface Overview {
  sortedFolder: string;
  courses: Course[];
  /** Sorted 휴지통에 있는 과목 수 */
  trashCount: number;
  changes: Change[];
  unprocessed: Unprocessed[];
}

export type Permission = "granted" | "denied" | "unknown";

/** 첫 실행 설정 (FR-15) */
export interface SetupStatus {
  downloadsAccess: Permission;
  sortedFolder: string;
  sortedFolderCreated: boolean;
  extensionConnected: boolean;
}

/** 과목을 알아내지 못한 파일 (FR-5) */
export interface AssignRequest {
  fileId: string;
  fileName: string;
  /** 다운로드할 때 보던 탭 제목. 과목을 고르는 단서로 보여 준다 */
  tabTitle?: string;
  atMs: number;
  courses: Course[];
}

export type AssignChoice = { courseId: string } | { newCourseName: string };

/** 같은 문서·같은 내용을 다시 받았을 때 (FR-7) */
export interface DuplicateNotice {
  id: string;
  fileName: string;
  courseName: string;
  week: string;
  existingPath: string;
  existingSavedAtMs: number;
}

export type DuplicateChoice = "openExisting" | "keepBoth";

/** 0~1 비율 좌표. 슬라이드 이미지 크기와 상관없이 쓴다 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PageChangeKind = "modified" | "added" | "removed";

export interface PageChange {
  kind: PageChangeKind;
  /** 새 버전의 장 번호. removed면 삭제된 장 바로 앞에 오는 새 버전의 장 (맨 앞이면 0) */
  page: number;
  /** removed일 때 이전 버전의 장 번호 */
  oldPage?: number;
  summary: string;
  /** 새 버전 슬라이드에서 강조할 부분. added면 비워 두고 장 전체를 강조한다 */
  regions: Region[];
}

export interface PageImage {
  page: number;
  /** 앱이 만들어 둔 페이지 이미지. Rust에서는 convertFileSrc로 바꿀 수 있는 경로를 넘긴다 */
  imageUrl: string;
}

/** 새 버전 변경 비교 (FR-9) */
export interface Comparison {
  documentId: string;
  fileName: string;
  courseName: string;
  oldVersion: number;
  newVersion: number;
  pages: PageImage[];
  changes: PageChange[];
}

/** 구버전 정리 (FR-10) */
export interface CleanupRequest {
  documentId: string;
  fileName: string;
  oldVersion: number;
  oldPath: string;
  sizeBytes: number;
  /** 받을 때의 해시와 달라졌으면 필기가 있다고 본다 */
  hasAnnotations: boolean;
}

export type CleanupChoice = "delete" | "keep";
