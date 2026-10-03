import type {
  AssignChoice,
  Course,
  CourseDetail,
  AssignRequest,
  CleanupChoice,
  CleanupRequest,
  Comparison,
  DuplicateChoice,
  DuplicateNotice,
  Overview,
  SetupStatus,
  TrashedCourse,
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
  /** 과목을 직접 추가한다. 정리 폴더에 같은 이름의 폴더가 생긴다 */
  addCourse(name: string): Promise<Course>;
  /** 과목명(=폴더 이름)을 바꾼다. 과목 ID와 자료는 그대로다 */
  renameCourse(courseId: string, name: string): Promise<void>;
  /** 과목을 Sorted 휴지통으로 옮긴다. 자료는 그대로 두어 되살릴 수 있다 */
  removeCourse(courseId: string): Promise<void>;

  trash(): Promise<TrashedCourse[]>;
  /** 휴지통의 과목을 되살린다. 같은 이름의 과목이 이미 있으면 거절한다 */
  restoreCourse(courseId: string): Promise<void>;
  /** 휴지통에서 지운다. 과목 폴더는 macOS 휴지통으로 가서 Finder에서는 아직 꺼낼 수 있다 */
  purgeCourse(courseId: string): Promise<void>;
  emptyTrash(): Promise<void>;
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
