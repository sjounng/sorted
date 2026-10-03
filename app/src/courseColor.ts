import type { Course } from "./api";

// LMS 대시보드의 과목 카드 색. 과목 목록 순서대로 돌려 써서 8과목까지는 색이 겹치지 않는다.
// 과목 탭과 최근 변경 탭이 같은 과목에 같은 색을 쓰도록 여기서만 정한다.
const COLORS = [
  "#e0638f",
  "#4a9eb7",
  "#6f9c5b",
  "#9d82d6",
  "#5aa287",
  "#ad8b2f",
  "#d9774b",
  "#5b7fd6",
];

export function courseColor(courses: Course[], name: string): string {
  const i = courses.findIndex((c) => c.name === name);
  return COLORS[Math.max(0, i) % COLORS.length];
}
