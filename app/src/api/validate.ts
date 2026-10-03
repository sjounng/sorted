import type { Course } from "./types";

const MAX = 40;

/**
 * 과목명이 폴더 이름으로 쓸 수 있는지 본다. 문제가 없으면 undefined.
 * 화면은 입력하는 동안 바로 보여 주고, 앱 본체도 같은 규칙으로 한 번 더 막는다.
 */
export function courseNameProblem(
  name: string,
  courses: Course[],
  exceptId?: string,
): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "과목명을 입력해 주세요.";
  if (trimmed.length > MAX) return `과목명은 ${MAX}자까지 쓸 수 있어요.`;
  if (/[/:]/.test(trimmed)) return "과목명에 / 나 : 는 쓸 수 없어요.";
  if (trimmed.startsWith(".")) return "과목명은 . 으로 시작할 수 없어요.";
  if (courses.some((c) => c.id !== exceptId && c.name === trimmed)) {
    return "같은 이름의 과목이 이미 있어요.";
  }
  return undefined;
}
