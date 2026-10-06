import { describe, expect, it } from "vitest";
import { byCourse, weeklyItems } from "./weekly.js";

// 주차학습 응답 모양을 줄여 만든 가짜 데이터 (사용자 정보 없음)
const MODULES = [
  {
    module_id: 1,
    title: "4주차: 직무분석",
    module_items: [
      {
        module_item_id: 501,
        title: "2강_직무분석",
        content_type: "attendance_item",
        completed: true,
        url: "https://learning.hanyang.ac.kr/learningx/lti/lecture_attendance/items/view/77?x=1",
        content_data: {
          course_id: 211742,
          title: "2강_직무분석",
          unlock_at: "2026-09-28T07:00:00Z",
          due_at: "2026-10-04T14:59:59Z",
          lock_at: "2026-10-04T14:59:59Z",
          late_at: null,
          item_content_data: { content_type: "mp4" },
        },
      },
      {
        module_item_id: 502,
        title: "강의자료.pdf",
        content_type: "file",
        content_data: { course_id: 211742, due_at: "2026-10-04T14:59:59Z" },
      },
    ],
  },
  {
    module_id: 2,
    title: "5주차",
    module_items: [
      {
        module_item_id: 601,
        content_type: "attendance_item",
        completed: false,
        url: "/learningx/lti/lecture_attendance/items/view/78",
        content_data: {
          course_id: 211742,
          title: "3강",
          unlock_at: "2026-10-05T07:00:00Z",
          due_at: "2026-10-11T14:59:59Z",
          late_at: "2026-10-18T14:59:59Z",
        },
      },
      { module_item_id: 602, content_type: "attendance_item", content_data: { course_id: 1 } },
      {
        module_item_id: 603,
        title: "학생 과제용 워크시트",
        content_type: "attendance_item",
        content_data: {
          course_id: 211742,
          due_at: "2026-12-20T14:59:59Z",
          item_content_data: { content_type: "pdf" },
        },
      },
    ],
  },
];

describe("weeklyItems", () => {
  const items = weeklyItems(MODULES, { 211742: "취업역량개발" });

  it("keeps only videos with a deadline (not worksheets)", () => {
    expect(items.map((i) => i.id)).toEqual(["video-501", "video-601"]);
  });

  it("maps fields to the app's ScheduleItem", () => {
    expect(items[0]).toEqual({
      id: "video-501",
      kind: "video",
      courseId: "211742",
      courseName: "취업역량개발",
      title: "2강_직무분석",
      dueAtMs: Date.parse("2026-10-04T14:59:59Z"),
      startAtMs: Date.parse("2026-09-28T07:00:00Z"),
      done: true,
      url: "https://learning.hanyang.ac.kr/courses/211742/modules/items/501",
    });
  });

  it("reads the late deadline and links to the Canvas module item", () => {
    expect(items[1]).toMatchObject({
      done: false,
      lateUntilMs: Date.parse("2026-10-18T14:59:59Z"),
      url: "https://learning.hanyang.ac.kr/courses/211742/modules/items/601",
    });
  });

  it("falls back to the LearningX link without a module item number", () => {
    const [only] = weeklyItems([
      {
        module_items: [
          {
            id: "x",
            content_type: "attendance_item",
            url: "/learningx/lti/lecture_attendance/items/view/9?a=1",
            content_data: { course_id: 1, due_at: "2026-10-11T14:59:59Z" },
          },
        ],
      },
    ]);
    expect(only.url).toBe(
      "https://learning.hanyang.ac.kr/learningx/lti/lecture_attendance/items/view/9",
    );
  });

  it("is safe with odd input", () => {
    expect(weeklyItems(null)).toEqual([]);
    expect(weeklyItems([{ module_items: "x" }, null])).toEqual([]);
    expect(weeklyItems(MODULES)[0].courseName).toBe("");
  });
});

describe("byCourse", () => {
  it("groups items by course id", () => {
    const groups = byCourse([
      { id: "a", courseId: "1" },
      { id: "b", courseId: "2" },
      { id: "c", courseId: "1" },
    ]);
    expect([...groups.keys()]).toEqual(["1", "2"]);
    expect(groups.get("1").map((i) => i.id)).toEqual(["a", "c"]);
  });
});
