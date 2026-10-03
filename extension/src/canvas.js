// 한양대 LMS(Canvas)에서 과목명과 주차를 알아낸다 (FR-11, FR-12, FR-17).
//
//   GET /api/v1/courses/<과목 ID>                          → 과목명
//   GET /api/v1/courses/<과목 ID>/modules?include[]=items  → 주차(모듈)와 그 안의 자료
//
// 응답에는 사용자 번호, 수강 정보 같은 값도 들어 있다. 여기서는 과목명과 주차만 꺼내고
// 나머지는 어디에도 넘기거나 저장하지 않는다.

export const LMS_ORIGIN = "https://learning.hanyang.ac.kr";

/** Canvas는 JSON 앞에 `while(1);`를 붙인다 (다른 사이트가 응답을 훔쳐 읽지 못하게). 떼고 읽는다. */
export function parseCanvasJson(text) {
  return JSON.parse(text.replace(/^\s*while\(1\);/, ""));
}

/**
 * Canvas 과목 이름에서 학기·학수번호 접두어를 뗀다.
 * "202620HY11171_소프트웨어공학" → { name: "소프트웨어공학", code: "HY11171" }
 */
export function splitCourseName(raw) {
  const m = /^(\d{6})([A-Z]{1,4}\d{3,6})_(.+)$/.exec(raw ?? "");
  return m ? { name: m[3].trim(), code: m[2] } : { name: (raw ?? "").trim(), code: null };
}

/** URL 경로의 `modules/items/<숫자>`. 자료 뷰어 탭에서 지금 보는 모듈 항목 번호 */
export function moduleItemIdOf(url) {
  return /modules\/items\/(\d+)/.exec(url ?? "")?.[1] ?? null;
}

/**
 * 모듈 이름에서 주차를 읽어 `N주차`로 맞춘다. 교수님마다 이름 짓는 방식이 달라서다.
 * "1주차/Unit-1" → "1주차", "Week 3" → "3주차". 숫자를 못 읽으면 모듈 이름 그대로.
 */
export function weekName(moduleName) {
  const raw = (moduleName ?? "").trim();
  const m = /(\d+)\s*주(?:차)?(?![가-힣])/.exec(raw) ?? /\bweek\s*-?\s*(\d+)/i.exec(raw);
  return m ? `${Number(m[1])}주차` : raw;
}

/** 이름 비교용: 확장자와 대소문자, 앞뒤 공백을 무시한다. */
function plain(name) {
  return (name ?? "")
    .trim()
    .replace(/\.pdf$/i, "")
    .toLowerCase();
}

/**
 * 받은 파일이 들어 있는 주차(모듈)를 찾는다.
 * 모듈 항목 번호가 있으면 그것으로, 없으면 항목 제목 = 파일 이름으로 찾는다.
 * @returns {{ name: string, position: number, matchedBy: "item" | "title" } | null}
 */
export function findWeek(modules, { moduleItemId, fileName }) {
  const week = (m, matchedBy) => ({ name: weekName(m.name), position: m.position, matchedBy });
  if (moduleItemId) {
    const m = modules.find((m) => (m.items ?? []).some((i) => String(i.id) === moduleItemId));
    if (m) return week(m, "item");
  }
  const target = plain(fileName);
  if (target) {
    const m = modules.find((m) => (m.items ?? []).some((i) => plain(i.title) === target));
    if (m) return week(m, "title");
  }
  return null;
}

/**
 * 과목명과 주차를 조회한다. 실패해도 예외를 던지지 않고 error에 이유를 담는다.
 * @param fetchText (url) => Promise<string>  쿠키를 실어 GET하고 본문을 돌려주는 함수
 */
export async function lookupCourse(fetchText, courseId, hint) {
  try {
    const base = `${LMS_ORIGIN}/api/v1/courses/${encodeURIComponent(courseId)}`;
    const course = parseCanvasJson(await fetchText(base));
    const modules = parseCanvasJson(
      await fetchText(`${base}/modules?include[]=items&per_page=100`),
    );
    // 항목이 많은 모듈은 Canvas가 items를 빼고 보낸다. 그런 모듈만 따로 받는다.
    for (const m of modules) {
      if (!m.items && m.items_url) {
        m.items = parseCanvasJson(await fetchText(`${m.items_url}?per_page=100`));
      }
    }
    const { name, code } = splitCourseName(course.name);
    return { courseName: name, courseCode: code, week: findWeek(modules, hint), error: null };
  } catch (err) {
    return { courseName: null, courseCode: null, week: null, error: String(err?.message ?? err) };
  }
}
