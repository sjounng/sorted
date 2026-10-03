import type { Schedule, ScheduleItem, ScheduleKind } from "./types";

// 일정 목업. 실제 LMS 응답(Canvas 플래너, 주차학습)에서 확인한 필드를 그대로 옮긴 모양이다.
// 날짜는 오늘을 기준으로 잡아서 목업이 낡지 않게 한다.

const LMS = "https://learning.hanyang.ac.kr";

/** 오늘에서 days일 뒤 hh:mm (이 컴퓨터 시간대) */
function at(days: number, hh: number, mm: number): number {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hh, mm, 59, 0);
  return d.getTime();
}

let seq = 0;
function item(
  kind: ScheduleKind,
  courseId: string,
  courseName: string,
  title: string,
  due: [number, number, number],
  options: { start?: [number, number, number]; done?: boolean } = {},
): ScheduleItem {
  seq += 1;
  const path =
    kind === "video"
      ? `learningx/lti/lecture_attendance/items/view/${900000 + seq}`
      : kind === "quiz"
        ? `courses/${courseId}/quizzes/${80000 + seq}`
        : kind === "event"
          ? `calendar?event_id=${210000 + seq}`
          : `courses/${courseId}/assignments/${2800000 + seq}`;
  return {
    id: `${kind}-${seq}`,
    kind,
    courseId,
    courseName,
    title,
    dueAtMs: at(...due),
    startAtMs: options.start ? at(...options.start) : undefined,
    done: options.done ?? false,
    url: `${LMS}/${path}`,
  };
}

export function mockSchedule(): Schedule {
  seq = 0;
  const items: ScheduleItem[] = [
    item("assignment", "11171", "소프트웨어공학", "cse406-phase-1-poster-submission", [6, 13, 0]),
    item("assignment", "11171", "소프트웨어공학", "Phase 1 요구사항 명세 (영어)", [-2, 23, 59], {
      done: true,
    }),
    item(
      "assignment",
      "11174",
      "테크노경영학(스타트업종합설계)",
      "[과제공지] 1차 과제(창업아이템제안서) 제출",
      [7, 23, 59],
    ),
    item(
      "assignment",
      "11174",
      "테크노경영학(스타트업종합설계)",
      "[완성하기] 5주차: 핵심정리노트",
      [20, 23, 59],
    ),
    item("video", "11182", "시스템감리론", "5강_감리 수행 절차", [1, 23, 59], {
      start: [-3, 16, 0],
    }),
    item("quiz", "11182", "시스템감리론", "4주차 확인 퀴즈", [3, 23, 59]),
    item("video", "11184", "확률및통계", "5주차_조건부확률", [0, 23, 59], { start: [-5, 16, 0] }),
    item("event", "11184", "확률및통계", "IC-PBL 팀 미팅 (화상 강의)", [2, 10, 0]),
    item("assignment", "11184", "확률및통계", "IC-PBL 1차 보고서", [12, 23, 59]),
    item("video", "11190", "생활법률", "4강 형사소송 절차", [-1, 23, 59], {
      start: [-6, 16, 0],
      done: true,
    }),
    item("video", "11190", "생활법률", "5강 소비자 계약", [7, 23, 59], { start: [1, 16, 0] }),
    item(
      "assignment",
      "11201",
      "사랑의실천2(스마트커뮤니케이션)",
      "[과제2] 역량진단검사 결과 제출",
      [9, 23, 59],
    ),
    item(
      "video",
      "11201",
      "사랑의실천2(스마트커뮤니케이션)",
      "3주차_스마트커뮤니케이션",
      [4, 23, 59],
      {
        start: [-2, 16, 0],
        done: true,
      },
    ),
    // Sorted에 없는 과목: LMS 이름 그대로, 회색으로 보인다
    item("quiz", "99001", "글쓰기와소통", "[정리하기] 5주차 Quiz", [3, 13, 59]),
    item("quiz", "99001", "글쓰기와소통", "2026년 2학기 중간고사", [14, 13, 15]),
  ];
  return { items, fetchedAtMs: Date.now() - 12 * 60_000 };
}
