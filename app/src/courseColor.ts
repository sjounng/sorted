import type { Course } from "./api";

// 과목 색. 앱 테마색(모브) 한 계열 안에서 밝기와 결만 조금씩 다르게 해 과목을 구분한다.
// 이 색은 점·테두리·글자에 그대로 쓰고, 카드 윗부분은 바탕색과 섞은 틴트 위에 점 격자를 깐다 (styles.css). 과목 탭과 최근 변경 탭이 같은 과목에 같은 색을 쓰도록 여기서만 정한다.
const COLORS = [
  "#a57c92", // 로지 모브
  "#8e7a9e", // 바이올렛 모브
  "#7a5a6e", // 플럼
  "#a0898f", // 토프 모브
  "#b08a9e", // 라이트 로즈
  "#6f6080", // 더스크
  "#9b6f86", // 베리
  "#857580", // 스모크
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
