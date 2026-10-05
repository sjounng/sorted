import { describe, expect, it } from "vitest";
import {
  findWeek,
  addLockTimes,
  lookupCourse,
  lookupPlanner,
  nextLink,
  planItems,
  plannerUrl,
  moduleItemIdOf,
  parseCanvasJson,
  splitCourseName,
  weekName,
} from "./canvas.js";

// 실제 응답 모양을 줄여 만든 가짜 데이터 (사용자·수강 정보 없음)
const COURSE = { id: 210208, name: "202620HY11171_소프트웨어공학" };
const MODULES = [
  {
    id: 2690118,
    name: "1주차",
    position: 1,
    items: [{ id: 8582053, title: "cse406-lec-00-v3", type: "ExternalTool" }],
  },
  {
    id: 2690119,
    name: "2주차",
    position: 2,
    items: [
      { id: 8582054, title: "cse406-lec-01-1-nature", type: "ExternalTool" },
      { id: 8582056, title: "cse406-lec-01-2-scope", type: "ExternalTool" },
    ],
  },
  {
    id: 2690131,
    name: "14주차",
    position: 14,
    items_url: "https://learning.hanyang.ac.kr/api/v1/courses/210208/modules/2690131/items",
  },
];
const wrap = (v) => `while(1);${JSON.stringify(v)}`;

describe("parseCanvasJson", () => {
  it("drops the while(1); guard", () => {
    expect(parseCanvasJson(wrap({ a: 1 }))).toEqual({ a: 1 });
    expect(parseCanvasJson('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("splitCourseName", () => {
  it("removes term and course number", () => {
    expect(splitCourseName("202620HY11171_소프트웨어공학")).toEqual({
      name: "소프트웨어공학",
      code: "HY11171",
    });
  });

  it("removes a term prefix without a course number", () => {
    expect(splitCourseName("202620HY_커리어개발 II 학생용 수업자료 강의실")).toEqual({
      name: "커리어개발 II 학생용 수업자료 강의실",
      code: null,
    });
  });

  it("keeps names in other formats as they are", () => {
    expect(splitCourseName("Software Engineering")).toEqual({
      name: "Software Engineering",
      code: null,
    });
    expect(splitCourseName(undefined)).toEqual({ name: "", code: null });
  });
});

describe("moduleItemIdOf", () => {
  it("reads the module item id from a viewer URL", () => {
    expect(
      moduleItemIdOf("https://learning.hanyang.ac.kr/courses/210208/modules/items/8582053"),
    ).toBe("8582053");
    expect(moduleItemIdOf("https://learning.hanyang.ac.kr/courses/210208")).toBeNull();
    expect(moduleItemIdOf(undefined)).toBeNull();
  });
});

describe("weekName", () => {
  it("reads the week number however the module is named", () => {
    expect(weekName("2주차")).toBe("2주차");
    expect(weekName("1주차/Unit-1")).toBe("1주차");
    expect(weekName(" 3 주차 (9/15~9/19) ")).toBe("3주차");
    expect(weekName("4주")).toBe("4주차");
    expect(weekName("Week 5")).toBe("5주차");
    expect(weekName("week-06")).toBe("6주차");
    expect(weekName("[Week01]")).toBe("1주차");
    expect(weekName("[Week12] 테스트 계획")).toBe("12주차");
  });

  it("keeps the module name when there is no week number", () => {
    expect(weekName("Unit-1")).toBe("Unit-1");
    expect(weekName("중간고사")).toBe("중간고사");
    expect(weekName("2주년 특강")).toBe("2주년 특강");
    expect(weekName(undefined)).toBe("");
  });
});

describe("findWeek", () => {
  it("prefers the module item id", () => {
    expect(findWeek(MODULES, { moduleItemId: "8582056", fileName: "cse406-lec-00-v3" })).toEqual({
      name: "2주차",
      position: 2,
      matchedBy: "item",
    });
  });

  it("falls back to title = file name, ignoring .pdf and case", () => {
    expect(findWeek(MODULES, { moduleItemId: null, fileName: "CSE406-lec-00-v3.pdf" })).toEqual({
      name: "1주차",
      position: 1,
      matchedBy: "title",
    });
  });

  it("normalizes the module name to N주차", () => {
    const modules = [{ name: "7주차/Unit-7", position: 7, items: [{ id: 1, title: "uml" }] }];
    expect(findWeek(modules, { moduleItemId: "1", fileName: null })).toEqual({
      name: "7주차",
      position: 7,
      matchedBy: "item",
    });
  });

  it("returns null when nothing matches", () => {
    expect(findWeek(MODULES, { moduleItemId: "1", fileName: "other" })).toBeNull();
    expect(findWeek(MODULES, { moduleItemId: null, fileName: null })).toBeNull();
  });
});

describe("lookupCourse", () => {
  const responses = {
    "https://learning.hanyang.ac.kr/api/v1/courses/210208": wrap(COURSE),
    "https://learning.hanyang.ac.kr/api/v1/courses/210208/modules?include[]=items&per_page=100":
      wrap(MODULES),
    "https://learning.hanyang.ac.kr/api/v1/courses/210208/modules/2690131/items?per_page=100": wrap(
      [{ id: 9, title: "late-slides" }],
    ),
  };
  const fakeFetch = async (url) => {
    if (!(url in responses)) throw new Error(`HTTP 404 ${url}`);
    return responses[url];
  };

  it("returns course name and week", async () => {
    const r = await lookupCourse(fakeFetch, "210208", {
      moduleItemId: null,
      fileName: "cse406-lec-00-v3",
    });
    expect(r).toEqual({
      courseName: "소프트웨어공학",
      courseCode: "HY11171",
      week: { name: "1주차", position: 1, matchedBy: "title" },
      error: null,
    });
  });

  it("fetches items for modules that came without them", async () => {
    const r = await lookupCourse(fakeFetch, "210208", {
      moduleItemId: null,
      fileName: "late-slides.pdf",
    });
    expect(r.week).toEqual({ name: "14주차", position: 14, matchedBy: "title" });
  });

  it("reports errors instead of throwing", async () => {
    const r = await lookupCourse(fakeFetch, "999", { moduleItemId: null, fileName: "x" });
    expect(r.courseName).toBeNull();
    expect(r.error).toContain("404");
  });
});

// 플래너 응답 모양을 줄여 만든 가짜 데이터 (사용자 정보 없음)
const PLANNER = [
  {
    plannable_type: "assignment",
    plannable_id: 2802020,
    course_id: 210208,
    context_name: "202620HY11171_소프트웨어공학",
    plannable_date: "2026-10-09T04:00:00Z",
    plannable: { title: "cse406-phase-1-poster-submission", due_at: "2026-10-09T04:00:00Z" },
    submissions: { submitted: false },
    html_url: "/courses/210208/assignments/2802020?foo=bar",
  },
  {
    plannable_type: "quiz",
    plannable_id: 77,
    course_id: 210208,
    context_name: "202620HY11171_소프트웨어공학",
    plannable: { title: "중간고사", due_at: "2026-10-17T04:15:00Z" },
    submissions: { submitted: true },
    html_url: "/courses/210208/quizzes/77",
  },
  {
    plannable_type: "calendar_event",
    plannable_id: 5,
    course_id: 213105,
    context_name: "사랑의실천3(기업가정신)",
    plannable: { title: "화상 강의", start_at: "2026-10-06T06:00:00Z" },
    submissions: false,
    planner_override: { marked_complete: true },
    html_url: "https://learning.hanyang.ac.kr/calendar?event_id=5",
  },
  {
    plannable_type: "announcement",
    plannable_id: 9,
    course_id: 210208,
    plannable: { title: "공지" },
  },
  { plannable_type: "assignment", plannable_id: 10, plannable: { title: "마감 없음" } },
  {
    plannable_type: "assignment",
    plannable_id: 11,
    plannable: { title: "밖 링크", due_at: "2026-11-01T00:00:00Z" },
    html_url: "https://evil.example/x",
  },
];

describe("planItems", () => {
  const items = planItems(PLANNER);

  it("keeps assignments, quizzes and events with a time", () => {
    expect(items.map((i) => i.id)).toEqual([
      "assignment-2802020",
      "quiz-77",
      "event-5",
      "assignment-11",
    ]);
  });

  it("maps fields to the app's ScheduleItem", () => {
    expect(items[0]).toEqual({
      id: "assignment-2802020",
      kind: "assignment",
      courseId: "210208",
      courseName: "소프트웨어공학",
      title: "cse406-phase-1-poster-submission",
      dueAtMs: Date.parse("2026-10-09T04:00:00Z"),
      done: false,
      url: "https://learning.hanyang.ac.kr/courses/210208/assignments/2802020",
    });
  });

  it("uses start time for events and reads done from submissions or the planner", () => {
    expect(items[1].done).toBe(true);
    expect(items[2]).toMatchObject({
      kind: "event",
      dueAtMs: Date.parse("2026-10-06T06:00:00Z"),
      done: true,
      url: "https://learning.hanyang.ac.kr/calendar",
    });
  });

  it("reads graded discussions as assignments by their assignment id", () => {
    const [graded, ungraded] = planItems([
      {
        plannable_type: "discussion_topic",
        plannable_id: 509114,
        course_id: 211699,
        plannable: { title: "생각해보기", due_at: "2026-12-20T14:59:59Z", assignment_id: 2807995 },
      },
      { plannable_type: "discussion_topic", plannable_id: 1, plannable: { title: "그냥 토론" } },
    ]);
    expect(graded).toMatchObject({ id: "assignment-2807995", kind: "assignment" });
    expect(ungraded).toBeUndefined();
  });

  it("uses lock_at after the due time as the late deadline", () => {
    const [late, noLate] = planItems([
      {
        plannable_type: "assignment",
        plannable_id: 1,
        plannable: { due_at: "2026-10-09T04:00:00Z", lock_at: "2026-10-12T14:59:00Z" },
      },
      {
        plannable_type: "assignment",
        plannable_id: 2,
        plannable: { due_at: "2026-10-09T04:00:00Z", lock_at: "2026-10-09T04:00:00Z" },
      },
    ]);
    expect(late.lateUntilMs).toBe(Date.parse("2026-10-12T14:59:00Z"));
    expect("lateUntilMs" in noLate).toBe(false);
  });

  it("never passes links outside the LMS", () => {
    expect(items[3]).toMatchObject({ url: "", courseId: "" });
  });
});

describe("planner paging", () => {
  it("builds the date range around now", () => {
    const url = plannerUrl(Date.parse("2026-10-04T00:00:00Z"));
    expect(url).toContain("start_date=2026-09-20");
    expect(url).toContain("end_date=2027-02-01");
  });

  it("follows rel=next only inside the LMS", () => {
    const next = "https://learning.hanyang.ac.kr/api/v1/planner/items?page=2";
    expect(nextLink(`<${next}>; rel="next", <https://x>; rel="last"`)).toBe(next);
    expect(nextLink('<https://evil.example/p2>; rel="next"')).toBeNull();
    expect(nextLink(null)).toBeNull();
  });

  it("reads every page", async () => {
    const pages = [
      { text: wrap(PLANNER.slice(0, 2)), link: '<https://learning.hanyang.ac.kr/p2>; rel="next"' },
      { text: wrap(PLANNER.slice(2)), link: null },
    ];
    const seen = [];
    const items = await lookupPlanner(async (url) => {
      seen.push(url);
      return pages[seen.length - 1];
    }, Date.now());
    expect(seen[1]).toBe("https://learning.hanyang.ac.kr/p2");
    expect(items).toHaveLength(4);
  });
});

describe("addLockTimes", () => {
  const due = Date.parse("2026-10-09T04:00:00Z");
  const items = [
    { id: "assignment-1", kind: "assignment", courseId: "210208", dueAtMs: due },
    { id: "quiz-7", kind: "quiz", courseId: "210208", dueAtMs: due },
    { id: "assignment-2", kind: "assignment", courseId: "999", dueAtMs: due },
    { id: "event-3", kind: "event", courseId: "210208", dueAtMs: due },
  ];

  it("asks once per course and fills lock_at after the due time", async () => {
    const asked = [];
    const out = await addLockTimes(async (url) => {
      asked.push(url);
      if (url.includes("/courses/999/")) throw new Error("HTTP 403");
      return {
        text: wrap([
          { id: 1, lock_at: "2026-10-12T14:59:00Z" },
          { id: 5, quiz_id: 7, lock_at: "2026-10-10T14:59:00Z" },
        ]),
        link: null,
      };
    }, items);
    expect(asked).toHaveLength(2);
    expect(out[0].lateUntilMs).toBe(Date.parse("2026-10-12T14:59:00Z"));
    expect(out[1].lateUntilMs).toBe(Date.parse("2026-10-10T14:59:00Z"));
    expect("lateUntilMs" in out[2]).toBe(false);
    expect("lateUntilMs" in out[3]).toBe(false);
  });
});
