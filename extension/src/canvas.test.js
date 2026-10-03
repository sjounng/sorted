import { describe, expect, it } from "vitest";
import {
  findWeek,
  lookupCourse,
  moduleItemIdOf,
  parseCanvasJson,
  postedAtOf,
  postOf,
  splitCourseName,
  weekFromDate,
} from "./canvas.js";

// 실제 응답 모양을 줄여 만든 가짜 데이터 (사용자·수강 정보 없음)
// 학기 시작: 2026-09-01 00:00 (KST)
const COURSE = {
  id: 210208,
  name: "202620HY11171_소프트웨어공학",
  start_at: "2026-08-31T15:00:00Z",
};
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

  it("returns null when nothing matches", () => {
    expect(findWeek(MODULES, { moduleItemId: "1", fileName: "other" })).toBeNull();
    expect(findWeek(MODULES, { moduleItemId: null, fileName: null })).toBeNull();
  });
});

describe("postOf", () => {
  const base = "https://learning.hanyang.ac.kr/courses/210208";
  it("reads announcements, discussions and assignments", () => {
    expect(postOf(`${base}/discussion_topics/551`)).toEqual({
      kind: "discussion_topics",
      id: "551",
    });
    expect(postOf(`${base}/announcements/552`)).toEqual({ kind: "discussion_topics", id: "552" });
    expect(postOf(`${base}/assignments/77`)).toEqual({ kind: "assignments", id: "77" });
  });

  it("returns null for other pages", () => {
    expect(postOf(`${base}/modules/items/8582053`)).toBeNull();
    expect(postOf(`${base}/assignments`)).toBeNull();
    expect(postOf(undefined)).toBeNull();
  });
});

describe("postedAtOf", () => {
  it("prefers the time students could see it", () => {
    const t = { created_at: "c", posted_at: "p", delayed_post_at: "d" };
    expect(postedAtOf(t, "discussion_topics")).toBe("p");
    expect(postedAtOf({ created_at: "c", delayed_post_at: "d" }, "discussion_topics")).toBe("d");
    expect(postedAtOf({ created_at: "c", unlock_at: "u" }, "assignments")).toBe("u");
    expect(postedAtOf({ created_at: "c", unlock_at: null }, "assignments")).toBe("c");
    expect(postedAtOf(null, "assignments")).toBeNull();
  });
});

describe("weekFromDate", () => {
  const start = COURSE.start_at;
  it("counts 7-day weeks from the term start", () => {
    expect(weekFromDate(start, "2026-08-31T15:00:00Z")).toEqual({
      name: "1주차",
      position: 1,
      matchedBy: "postDate",
    });
    // 9월 7일 23:59 (KST)까지 1주차, 9월 8일 00:00부터 2주차
    expect(weekFromDate(start, "2026-09-07T14:59:00Z")?.name).toBe("1주차");
    expect(weekFromDate(start, "2026-09-07T15:00:00Z")?.name).toBe("2주차");
    expect(weekFromDate(start, "2026-10-02T03:00:00Z")?.name).toBe("5주차");
  });

  it("returns null before the term or when a date is missing", () => {
    expect(weekFromDate(start, "2026-08-20T00:00:00Z")).toBeNull();
    expect(weekFromDate(null, "2026-09-02T00:00:00Z")).toBeNull();
    expect(weekFromDate(start, null)).toBeNull();
  });
});

describe("lookupCourse", () => {
  const responses = {
    "https://learning.hanyang.ac.kr/api/v1/courses/210208?include[]=term": wrap(COURSE),
    "https://learning.hanyang.ac.kr/api/v1/courses/210208/discussion_topics/551": wrap({
      id: 551,
      title: "과제 1 안내",
      posted_at: "2026-09-15T01:00:00Z",
    }),
    "https://learning.hanyang.ac.kr/api/v1/courses/210208/assignments/77": wrap({
      id: 77,
      created_at: "2026-09-20T01:00:00Z",
      unlock_at: null,
    }),
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

  it("uses the post date when the file is not in any module (FR-17)", async () => {
    const r = await lookupCourse(fakeFetch, "210208", {
      moduleItemId: null,
      fileName: "hw1-spec.pdf",
      post: { kind: "discussion_topics", id: "551" },
    });
    expect(r.week).toEqual({ name: "3주차", position: 3, matchedBy: "postDate" });

    const a = await lookupCourse(fakeFetch, "210208", {
      moduleItemId: null,
      fileName: "hw2-spec.pdf",
      post: { kind: "assignments", id: "77" },
    });
    expect(a.week?.name).toBe("3주차");
  });

  it("module week wins over the post date", async () => {
    const r = await lookupCourse(fakeFetch, "210208", {
      moduleItemId: null,
      fileName: "cse406-lec-00-v3",
      post: { kind: "discussion_topics", id: "551" },
    });
    expect(r.week).toEqual({ name: "1주차", position: 1, matchedBy: "title" });
  });

  it("keeps the course name when the post lookup fails", async () => {
    const r = await lookupCourse(fakeFetch, "210208", {
      moduleItemId: null,
      fileName: "x.pdf",
      post: { kind: "assignments", id: "404" },
    });
    expect(r).toMatchObject({ courseName: "소프트웨어공학", week: null, error: null });
  });

  it("falls back to the term start date", async () => {
    const noStart = { ...COURSE, start_at: null, term: { start_at: COURSE.start_at } };
    const f = async (url) => (url.endsWith("?include[]=term") ? wrap(noStart) : fakeFetch(url));
    const r = await lookupCourse(f, "210208", {
      moduleItemId: null,
      fileName: "x.pdf",
      post: { kind: "discussion_topics", id: "551" },
    });
    expect(r.week?.name).toBe("3주차");
  });

  it("reports errors instead of throwing", async () => {
    const r = await lookupCourse(fakeFetch, "999", { moduleItemId: null, fileName: "x" });
    expect(r.courseName).toBeNull();
    expect(r.error).toContain("404");
  });
});
