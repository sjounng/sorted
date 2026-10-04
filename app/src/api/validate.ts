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
  if (!trimmed) return "Enter a class name.";
  if (trimmed.length > MAX) return `Class names can be up to ${MAX} characters.`;
  if (/[/:]/.test(trimmed)) return "Class names can’t contain / or :.";
  if (trimmed.startsWith(".")) return "Class names can’t start with a dot.";
  if (courses.some((c) => c.id !== exceptId && c.name === trimmed)) {
    return "A class with this name already exists.";
  }
  return undefined;
}
