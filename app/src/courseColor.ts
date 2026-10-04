import type { Course } from "./api";

// 과목 색. 레퍼런스(Budget Dashboard)처럼 채도 낮은 흙빛·파스텔 계열.
// 이 색은 점·테두리·글자에 그대로 쓰고, 카드 윗부분은 바탕색과 섞은 연한 틴트로 칠한다 (styles.css --course-tint). 과목 탭과 최근 변경 탭이 같은 과목에 같은 색을 쓰도록 여기서만 정한다.
const COLORS = [
  "#a8906f", // 오트 (레퍼런스 OVERVIEW)
  "#7fa08a", // 세이지 (LEFT TO SPEND)
  "#d0906c", // 피치 (SAVE LEFT)
  "#9c88c4", // 라벤더 (UNDER BUDGET)
  "#7f9bb8", // 더스티 블루
  "#c4a257", // 버터
  "#c48a98", // 로즈
  "#8e9568", // 올리브
];

// 한 번 정한 색은 과목 ID에 붙여 둔다. 과목을 지우거나 이름을 바꿔도 다른 과목의 색이 바뀌지 않는다.
const assigned = new Map<string, string>();

/** 과목 ID의 색. 처음 보는 과목은 지금 가장 적게 쓰인 색을 받는다 (8과목까지는 겹치지 않음). */
export function courseColor(courses: Course[], courseId: string): string {
  // 목록 순서대로 먼저 정해 두어야 처음 열 때 순서대로 색이 붙는다.
  for (const c of courses) pick(c.id, courses);
  return pick(courseId, courses);
}

function pick(courseId: string, courses: Course[]): string {
  const known = assigned.get(courseId);
  if (known) return known;

  const live = new Set(courses.map((c) => c.id));
  const uses = new Map(COLORS.map((color) => [color, 0]));
  for (const [id, color] of assigned) {
    if (live.has(id)) uses.set(color, (uses.get(color) ?? 0) + 1);
  }
  const color = COLORS.reduce((best, c) => (uses.get(c)! < uses.get(best)! ? c : best));
  assigned.set(courseId, color);
  return color;
}
