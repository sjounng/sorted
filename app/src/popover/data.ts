// 메뉴 막대 팝오버(FR-13)가 보여 주는 데이터.
// 판정 코어가 아직 없어서 가짜 데이터를 쓴다. 코어가 생기면 이 파일의 load()를 invoke 호출로 바꾼다.

export interface Course {
  id: string;
  name: string;
  /** 과목 폴더 안의 PDF 수 */
  fileCount: number;
  /** 가장 최근에 받은 자료의 주차 */
  latestWeek: string;
}

export type ChangeKind = "organized" | "newVersion" | "duplicate";

export interface Change {
  id: string;
  kind: ChangeKind;
  courseName: string;
  fileName: string;
  /** 새 버전일 때 바뀐 장 수 */
  changedPages?: number;
  atMs: number;
}

export interface Unprocessed {
  id: string;
  fileName: string;
  reason: string;
  atMs: number;
}

export interface PopoverData {
  courses: Course[];
  changes: Change[];
  unprocessed: Unprocessed[];
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export async function load(): Promise<PopoverData> {
  const now = Date.now();
  return {
    courses: [
      { id: "210208", name: "소프트웨어공학", fileCount: 12, latestWeek: "5주차" },
      { id: "210311", name: "운영체제", fileCount: 9, latestWeek: "5주차" },
      { id: "209876", name: "컴퓨터네트워크", fileCount: 7, latestWeek: "4주차" },
    ],
    changes: [
      {
        id: "c1",
        kind: "newVersion",
        courseName: "소프트웨어공학",
        fileName: "Phase1_과제명세.pdf",
        changedPages: 3,
        atMs: now - 4 * MINUTE,
      },
      {
        id: "c2",
        kind: "organized",
        courseName: "운영체제",
        fileName: "05_Scheduling.pdf",
        atMs: now - 2 * HOUR,
      },
      {
        id: "c3",
        kind: "duplicate",
        courseName: "컴퓨터네트워크",
        fileName: "04_TransportLayer.pdf",
        atMs: now - DAY - 3 * HOUR,
      },
    ],
    unprocessed: [
      {
        id: "u1",
        fileName: "original.pdf",
        reason: "과목을 알아내지 못했어요",
        atMs: now - 30 * MINUTE,
      },
      {
        id: "u2",
        fileName: "original (1).pdf",
        reason: "LMS 로그인이 만료된 것 같아요",
        atMs: now - 3 * DAY,
      },
    ],
  };
}

/** "방금", "4분 전", "2시간 전", "어제", "3일 전" */
export function ago(atMs: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs - atMs);
  if (diff < MINUTE) return "방금";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`;
  if (diff < 2 * DAY) return "어제";
  return `${Math.floor(diff / DAY)}일 전`;
}
