import { describe, expect, it } from "vitest";
import {
  findWeek,
  lookupCourse,
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
