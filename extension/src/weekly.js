import { LMS_ORIGIN } from "./canvas.js";

// 주차학습(LearningX) 영상 일정 (FR-19).
// 사용자가 주차학습 페이지를 열면 그 페이지가 받는 주차 목록 응답(`…modules?include_detail=true`)을
// 확장이 복사해 받는다 (weekly-page.js → weekly-bridge.js → background.js). LMS에 새로 요청하지 않고,
// 쿠키·토큰은 읽지 않는다. 앱에는 아래에서 고른 일정만 넘기고 출석 기록 등 나머지는 버린다.
//
// 응답 모양 (주차 → 항목):
//   [{ title, module_items: [{ title, content_type: "attendance_item", completed, url,
//        content_data: { course_id, title, unlock_at, due_at, lock_at, late_at,
//                        item_content_data: { content_type: "mp4" } } }] }]

/** 출석 항목으로 올라오지만 영상이 아닌 콘텐츠 종류 (워크시트·자료 파일) */
const DOCUMENT_TYPE =
  /pdf|doc|ppt|hwp|xls|csv|txt|zip|file|image|jpe?g|png|gif|html?|link|url|text|word|excel|powerpoint/;

/**
 * 영상 항목인가: 출석 항목 중 문서가 아닌 것.
 * 영상의 콘텐츠 종류 이름은 올린 방식(mp4, LMS 자체 플레이어, 녹화 등)마다 달라서 영상 이름을 고르면
 * 같은 주차의 영상도 빠진다. 그래서 문서 종류만 뺀다.
 */
function isVideo(item) {
  if (item?.content_type !== "attendance_item") return false;
  const type = String(item?.content_data?.item_content_data?.content_type ?? "").toLowerCase();
  return !DOCUMENT_TYPE.test(type);
}

/**
 * 영상을 여는 주소. 응답의 url(LearningX 내부 주소)은 과목 화면 안에서만 열려 브라우저로 바로 열면
 * 오류가 난다. 그래서 Canvas 모듈 항목 주소(courses/<과목>/modules/items/<번호>)로 연다:
 * LMS가 과목 안에서 그 영상을 띄워 준다. 번호가 없을 때만 응답의 url을 쓴다.
 */
function videoUrl(courseId, moduleItemId, url) {
  if (moduleItemId != null && /^\d+$/.test(String(moduleItemId))) {
    return `${LMS_ORIGIN}/courses/${courseId}/modules/items/${moduleItemId}`;
  }
  return lmsUrl(url);
}

/** LMS 안의 주소를 쿼리 없는 절대 주소로. LMS 밖이면 빈 문자열 */
function lmsUrl(path) {
  try {
    const u = new URL(path ?? "", LMS_ORIGIN);
    return u.origin === LMS_ORIGIN ? `${u.origin}${u.pathname}` : "";
  } catch {
    return "";
  }
}

const time = (s) => {
  const ms = Date.parse(s ?? "");
  return Number.isFinite(ms) ? ms : undefined;
};

/**
 * 주차 목록 응답을 앱의 일정(ScheduleItem, docs/app-api.md)으로 바꾼다.
 * @param modules 주차학습 응답
 * @param courseNames { [과목 ID]: 과목명 } 플래너에서 받아 둔 이름 (응답에는 과목명이 없다)
 */
export function weeklyItems(modules, courseNames = {}) {
  if (!Array.isArray(modules)) return [];
  return modules.flatMap((m) =>
    (Array.isArray(m?.module_items) ? m.module_items : []).flatMap((item) => {
      if (!isVideo(item)) return [];
      const data = item.content_data ?? {};
      const dueAtMs = time(data.due_at) ?? time(data.lock_at);
      const key = item.module_item_id ?? item.id ?? data.id;
      if (dueAtMs === undefined || key == null || data.course_id == null) return [];
      const courseId = String(data.course_id);
      const startAtMs = time(data.unlock_at);
      const lateUntilMs = time(data.late_at);
      return [
        {
          id: `video-${key}`,
          kind: "video",
          courseId,
          courseName: courseNames[courseId] ?? "",
          title: data.title ?? item.title ?? "",
          dueAtMs,
          ...(startAtMs !== undefined && { startAtMs }),
          ...(lateUntilMs !== undefined && lateUntilMs > dueAtMs && { lateUntilMs }),
          done: item.completed === true,
          url: videoUrl(courseId, item.module_item_id, item.url),
        },
      ];
    }),
  );
}

/** 과목별로 묶는다: Map<과목 ID, 일정[]>. 앱은 과목마다 따로 덮어쓴다 */
export function byCourse(items) {
  const groups = new Map();
  for (const item of items) {
    groups.set(item.courseId, [...(groups.get(item.courseId) ?? []), item]);
  }
  return groups;
}
