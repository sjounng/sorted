import type {
  AssignChoice,
  CourseDetail,
  AssignRequest,
  CleanupChoice,
  CleanupRequest,
  Comparison,
  DuplicateChoice,
  DuplicateNotice,
  Overview,
  SetupStatus,
} from "./types";

/**
 * 화면이 앱 본체에 요청하는 모든 것.
 * 목업(mock.ts)과 실제 구현(tauri.ts)이 같은 모양을 갖는다.
 */
export interface Backend {
  overview(): Promise<Overview>;
  /** 메뉴 막대 데이터가 바뀔 때마다 부른다. 돌려받은 함수로 구독을 끊는다 */
  onOverviewChanged(callback: () => void): Promise<() => void>;

  courseDetail(courseId: string): Promise<CourseDetail>;
  /** PDF를 기본 앱(미리보기 등)으로 연다 */
  openFile(path: string): Promise<void>;

  setupStatus(): Promise<SetupStatus>;
  requestDownloadsAccess(): Promise<SetupStatus>;
  openSystemSettings(): Promise<void>;
  revealInFinder(path: string): Promise<void>;

  assignRequest(fileId: string): Promise<AssignRequest>;
  assignCourse(fileId: string, choice: AssignChoice): Promise<void>;
  skipAssign(fileId: string): Promise<void>;

  duplicateNotice(id: string): Promise<DuplicateNotice>;
  resolveDuplicate(id: string, choice: DuplicateChoice): Promise<void>;

  comparison(documentId: string): Promise<Comparison>;

  cleanupRequest(documentId: string): Promise<CleanupRequest>;
  resolveCleanup(documentId: string, choice: CleanupChoice): Promise<void>;
}
