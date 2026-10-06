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
  Schedule,
  Language,
  SetupStatus,
  Settings,
  TrashedCourse,
} from "./types";

/**
 * 화면이 앱 본체에 요청하는 모든 것.
 * 목업(mock.ts)과 실제 구현(tauri.ts)이 같은 모양을 갖는다.
 */
export interface Backend {
  /** 언어 등 설정 (#46) */
  settings(): Promise<Settings>;
  /** 언어를 바꾸고 저장한다. 열린 창들에 settings-changed로 알린다 */
  setLanguage(language: Language): Promise<Settings>;
  /** 설정이 바뀔 때마다 부른다. 돌려받은 함수로 구독을 끊는다 */
  onSettingsChanged(callback: (settings: Settings) => void): Promise<() => void>;

  overview(): Promise<Overview>;
  /** 메인 창 데이터가 바뀔 때마다 부른다. 돌려받은 함수로 구독을 끊는다 */
  onOverviewChanged(callback: () => void): Promise<() => void>;

  courseDetail(courseId: string): Promise<CourseDetail>;
  /** 과목을 직접 추가한다. 정리 폴더에 같은 이름의 폴더가 생긴다 */
  addCourse(name: string): Promise<Course>;
  /** 과목명(=폴더 이름)을 바꾼다. 과목 ID와 자료는 그대로다 */
  renameCourse(courseId: string, name: string): Promise<void>;
  /** 과목을 Sorted 휴지통으로 옮긴다. 자료는 그대로 두어 되살릴 수 있다 */
  removeCourse(courseId: string): Promise<void>;

  /** 확장이 LMS에서 읽어 둔 일정 */
  schedule(): Promise<Schedule>;
  /** LMS 페이지 등 웹 주소를 기본 브라우저로 연다 */
  openInBrowser(url: string): Promise<void>;

  trash(): Promise<TrashedCourse[]>;
  /** 휴지통의 과목을 되살린다. 같은 이름의 과목이 이미 있으면 거절한다 */
  restoreCourse(courseId: string): Promise<void>;
  /** 휴지통에서 지운다. 과목 폴더는 macOS 휴지통으로 가서 Finder에서는 아직 꺼낼 수 있다 */
  purgeCourse(courseId: string): Promise<void>;
  emptyTrash(): Promise<void>;
  /** PDF를 기본 앱(미리보기 등)으로 연다 */
  openFile(path: string): Promise<void>;
  /** 받은 그대로의 원본을 연다. 필기한 파일이면 임시 사본을 열고, 거기에 필기하면 새 필기본이 된다 */
  openOriginal(documentId: string, version: number): Promise<void>;
  /** 필기본 이름 바꾸기. 빈 이름이면 "필기 N"으로 되돌린다. 파일 이름은 그대로 */
  renameAnnotation(documentId: string, version: number, n: number, name: string): Promise<void>;

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
