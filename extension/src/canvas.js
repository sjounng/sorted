// 한양대 LMS(Canvas)에서 과목명과 주차를 알아낸다 (FR-11, FR-12, FR-17).
//
//   GET /api/v1/courses/<과목 ID>?include[]=term           → 과목명, 학기 시작일
//   GET /api/v1/courses/<과목 ID>/modules?include[]=items  → 주차(모듈)와 그 안의 자료
//   GET /api/v1/courses/<과목 ID>/discussion_topics/<번호> → 공지·토론 게시일 (모듈 밖 자료)
//   GET /api/v1/courses/<과목 ID>/assignments/<번호>       → 과제 게시일 (모듈 밖 자료)
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
 * 탭 주소가 공지·토론·과제 게시물이면 그 종류와 번호. 모듈 밖 자료를 받은 곳이다 (FR-17).
 * Canvas는 공지도 discussion_topics로 다룬다.
 * @returns {{ kind: "discussion_topics" | "assignments", id: string } | null}
 */
export function postOf(url) {
  const m = /\/courses\/\d+\/(discussion_topics|announcements|assignments)\/(\d+)/.exec(url ?? "");
  if (!m) return null;
  return { kind: m[1] === "assignments" ? "assignments" : "discussion_topics", id: m[2] };
}

/** 게시물이 학생에게 보이기 시작한 시각. 예약 게시·열림 시각이 있으면 그것을 쓴다. */
export function postedAtOf(post, kind) {
  if (!post) return null;
  if (kind === "assignments") return post.unlock_at ?? post.created_at ?? null;
  return post.posted_at ?? post.delayed_post_at ?? post.created_at ?? null;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 학기 시작일과 게시일의 차이로 주차를 계산한다. 시작일 당일~6일 뒤가 1주차.
 * 둘 중 하나라도 모르거나 학기 시작 전이면 null (→ 앱이 미분류에 둔다).
 */
export function weekFromDate(startAt, postedAt) {
  const diff = Date.parse(postedAt) - Date.parse(startAt);
  if (!Number.isFinite(diff) || diff < 0) return null;
  const n = Math.floor(diff / WEEK_MS) + 1;
  return { name: `${n}주차`, position: n, matchedBy: "postDate" };
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
  const week = (m, matchedBy) => ({ name: m.name, position: m.position, matchedBy });
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
 * 주차는 모듈에서 먼저 찾고, 모듈에 없으면 받은 게시물의 게시일로 계산한다 (FR-17).
 * @param fetchText (url) => Promise<string>  쿠키를 실어 GET하고 본문을 돌려주는 함수
 * @param hint { moduleItemId, fileName, post }  post는 postOf(탭 주소)
 */
export async function lookupCourse(fetchText, courseId, hint) {
  try {
    const base = `${LMS_ORIGIN}/api/v1/courses/${encodeURIComponent(courseId)}`;
    const course = parseCanvasJson(await fetchText(`${base}?include[]=term`));
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
    const week =
      findWeek(modules, hint) ??
      (await weekFromPost(fetchText, base, course.start_at ?? course.term?.start_at, hint?.post));
    return { courseName: name, courseCode: code, week, error: null };
  } catch (err) {
    return { courseName: null, courseCode: null, week: null, error: String(err?.message ?? err) };
  }
}

/** 게시물의 게시일로 주차를 계산한다. 조회가 실패하면 과목명은 살리고 주차만 null. */
async function weekFromPost(fetchText, base, startAt, post) {
  if (!post || !startAt) return null;
  try {
    const p = parseCanvasJson(await fetchText(`${base}/${post.kind}/${post.id}`));
    return weekFromDate(startAt, postedAtOf(p, post.kind));
  } catch {
    return null;
  }
}
