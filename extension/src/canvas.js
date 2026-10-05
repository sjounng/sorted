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
  if (m) return { name: m[3].trim(), code: m[2] };
  // 과목 번호 없이 학기만 붙은 이름: "202620HY_커리어개발 II" → "커리어개발 II"
  const term = /^\d{6}[A-Z]{0,4}_(.+)$/.exec(raw ?? "");
  return { name: (term ? term[1] : (raw ?? "")).trim(), code: null };
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

// ── 일정 (FR-19) ──────────────────────────────────────
// 과제·퀴즈·시험·화상 강의 마감은 Canvas 플래너에서 읽는다. 공지와 그 밖의 종류는 버린다.
// 앱에는 정리한 일정만 넘긴다: 사용자 번호, 서명이 붙은 이미지 주소, 링크의 쿼리는 넘기지 않는다.

/** 플래너에서 읽는 기간: 2주 전 ~ 4달 뒤 */
const PLANNER_PAST_DAYS = 14;
const PLANNER_AHEAD_DAYS = 120;
/** 한 번에 읽는 최대 쪽 수 (쪽마다 50개) */
const PLANNER_MAX_PAGES = 10;

const PLANNER_KIND = { assignment: "assignment", quiz: "quiz", calendar_event: "event" };

/**
 * 플래너 항목의 종류와 ID. 점수가 있는 토론(assignment_id가 있는 discussion_topic)은 과제로 본다
 * ("[완성하기] N주차: 생각해보기" 같은 것). ID는 과제 번호로 맞춰 과제 목록의 lock_at과 이을 수 있게 한다.
 */
function kindAndId(p) {
  if (p?.plannable_type === "discussion_topic") {
    const assignmentId = p.plannable?.assignment_id;
    return assignmentId == null ? null : { kind: "assignment", id: `assignment-${assignmentId}` };
  }
  const kind = PLANNER_KIND[p?.plannable_type];
  return kind && p.plannable_id != null ? { kind, id: `${kind}-${p.plannable_id}` } : null;
}

/** 첫 쪽 주소 */
export function plannerUrl(nowMs) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const DAY = 24 * 60 * 60 * 1000;
  const start = day(nowMs - PLANNER_PAST_DAYS * DAY);
  const end = day(nowMs + PLANNER_AHEAD_DAYS * DAY);
  return `${LMS_ORIGIN}/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=50`;
}

/** `Link` 헤더의 rel="next" 주소. LMS 주소가 아니면 따라가지 않는다. */
export function nextLink(header) {
  for (const part of (header ?? "").split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part);
    if (m && m[1].startsWith(`${LMS_ORIGIN}/`)) return m[1];
  }
  return null;
}

/** LMS 안의 상대·절대 주소를 쿼리 없는 절대 주소로. LMS 밖이면 빈 문자열. */
function lmsUrl(path) {
  try {
    const u = new URL(path ?? "", LMS_ORIGIN);
    return u.origin === LMS_ORIGIN ? `${u.origin}${u.pathname}` : "";
  } catch {
    return "";
  }
}

/**
 * 플래너 항목을 앱의 일정(ScheduleItem, docs/app-api.md)으로 바꾼다.
 * 마감 시각을 모르는 항목, 공지 등은 버린다.
 */
export function planItems(raw) {
  return (raw ?? []).flatMap((p) => {
    const picked = kindAndId(p);
    if (!picked) return [];
    const { kind, id } = picked;
    const plannable = p.plannable ?? {};
    const when = kind === "event" ? plannable.start_at : (plannable.due_at ?? p.plannable_date);
    const dueAtMs = Date.parse(when ?? "");
    if (!Number.isFinite(dueAtMs)) return [];
    // 제출이 닫히는 시각: 마감 뒤에도 그때까지는 늦게 낼 수 있다 (화면의 "지각 인정 중")
    const lockAtMs = Date.parse(plannable.lock_at ?? "");
    const late = kind !== "event" && Number.isFinite(lockAtMs) && lockAtMs > dueAtMs;
    return [
      {
        id,
        kind,
        courseId: p.course_id == null ? "" : String(p.course_id),
        courseName: splitCourseName(p.context_name).name,
        title: plannable.title ?? plannable.name ?? "",
        dueAtMs,
        ...(late && { lateUntilMs: lockAtMs }),
        done: p.submissions?.submitted === true || p.planner_override?.marked_complete === true,
        url: lmsUrl(p.html_url),
      },
    ];
  });
}

/**
 * 과제·퀴즈의 제출이 닫히는 시각(lock_at)을 채운다. 플래너 응답에는 lock_at이 없어서,
 * 과제·퀴즈가 있는 과목마다 과제 목록을 한 번씩 받는다 (과제 수가 아니라 과목 수만큼).
 * 퀴즈는 과제 목록의 quiz_id로 맞춘다. 실패한 과목은 건너뛴다.
 * @param fetchPage (url) => Promise<{ text, link }>
 */
export async function addLockTimes(fetchPage, items) {
  const courses = [
    ...new Set(
      items
        .filter((i) => (i.kind === "assignment" || i.kind === "quiz") && i.courseId)
        .map((i) => i.courseId),
    ),
  ];
  const lockOf = new Map();
  for (const courseId of courses) {
    try {
      let url = `${LMS_ORIGIN}/api/v1/courses/${encodeURIComponent(courseId)}/assignments?per_page=100`;
      for (let page = 0; url && page < PLANNER_MAX_PAGES; page++) {
        const { text, link } = await fetchPage(url);
        for (const a of parseCanvasJson(text)) {
          const lock = Date.parse(a?.lock_at ?? "");
          if (!Number.isFinite(lock)) continue;
          lockOf.set(`assignment-${a.id}`, lock);
          if (a.quiz_id != null) lockOf.set(`quiz-${a.quiz_id}`, lock);
        }
        url = nextLink(link);
      }
    } catch {
      // 이 과목은 지각 마감 없이 둔다
    }
  }
  return items.map((i) => {
    const lock = lockOf.get(i.id);
    return lock !== undefined && lock > i.dueAtMs && i.lateUntilMs === undefined
      ? { ...i, lateUntilMs: lock }
      : i;
  });
}

/**
 * 플래너를 쪽마다 읽어 일정으로 바꾼다. 실패하면 예외를 던진다 (부른 쪽이 다음에 다시 시도).
 * @param fetchPage (url) => Promise<{ text: string, link: string | null }>  쿠키를 실어 GET
 */
export async function lookupPlanner(fetchPage, nowMs, log = () => {}) {
  const raw = [];
  let url = plannerUrl(nowMs);
  for (let i = 0; url && i < PLANNER_MAX_PAGES; i++) {
    const { text, link } = await fetchPage(url);
    raw.push(...parseCanvasJson(text));
    url = nextLink(link);
  }
  const items = planItems(raw);
  log(`플래너 ${raw.length}개 중 일정 ${items.length}개`);
  const withLocks = await addLockTimes(fetchPage, items);
  log(`지각 마감 ${withLocks.filter((i) => i.lateUntilMs !== undefined).length}개`);
  return withLocks;
}
