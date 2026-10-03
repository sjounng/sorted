import { describe, expect, it } from "vitest";
import {
  buildDownloadMessage,
  courseIdOf,
  isLmsDownload,
  isLmsHost,
  queryParam,
  withoutQuery,
} from "./lms.js";

// 1차 스파이크에서 본 모양을 따라 만든 가짜 값 (학번은 가짜)
const DOWNLOAD_URL =
  "https://hycms.hanyang.ac.kr/index.php?module=xn_media_content2013&act=dispXn_media_content2013DownloadWebFile" +
  "&site_id=hanyang101&content_id=abc123&file_subpath=contents%5Cweb_files%5Coriginal.pdf&file_name=CSE406_Lec03.pdf";
const REFERRER =
  "https://hycms.hanyang.ac.kr/em/xyz?TargetUrl=" +
  encodeURIComponent(
    "https://learning.hanyang.ac.kr/learningx/api/v1/courses/210208/modules?user_id=2099000000",
  );
const TAB = {
  url: "https://learning.hanyang.ac.kr/courses/210208/modules?x=1",
  title: "소프트웨어공학",
};

describe("isLmsHost / isLmsDownload", () => {
  it("accepts Hanyang LMS hosts only", () => {
    expect(isLmsHost("hycms.hanyang.ac.kr")).toBe(true);
    expect(isLmsHost("learning.hanyang.ac.kr")).toBe(true);
    expect(isLmsHost("evilhanyang.ac.kr")).toBe(false);
    expect(isLmsHost("hanyang.ac.kr.evil.com")).toBe(false);
  });

  it("detects by download URL or referrer", () => {
    expect(isLmsDownload({ url: DOWNLOAD_URL })).toBe(true);
    expect(isLmsDownload({ url: "https://cdn.example.com/a.pdf", referrer: TAB.url })).toBe(true);
    expect(isLmsDownload({ url: "https://arxiv.org/pdf/1.pdf", referrer: "" })).toBe(false);
  });
});

describe("query handling", () => {
  it("strips the query and hash", () => {
    expect(withoutQuery(TAB.url + "#top")).toBe(
      "https://learning.hanyang.ac.kr/courses/210208/modules",
    );
    expect(withoutQuery("not a url")).toBe("");
    expect(withoutQuery(undefined)).toBe("");
  });

  it("reads single params", () => {
    expect(queryParam(DOWNLOAD_URL, "content_id")).toBe("abc123");
    expect(queryParam(DOWNLOAD_URL, "file_name")).toBe("CSE406_Lec03.pdf");
    expect(queryParam(DOWNLOAD_URL, "missing")).toBeNull();
  });
});

describe("courseIdOf", () => {
  it("finds the id in a plain URL", () => {
    expect(courseIdOf(TAB.url)).toBe("210208");
  });

  it("finds the id inside an encoded referrer", () => {
    expect(courseIdOf(REFERRER)).toBe("210208");
  });

  it("returns null when absent", () => {
    expect(courseIdOf(DOWNLOAD_URL)).toBeNull();
    expect(courseIdOf(undefined)).toBeNull();
    expect(courseIdOf("%E0%A4%A")).toBeNull(); // 잘못된 인코딩
  });
});

describe("buildDownloadMessage", () => {
  const item = {
    url: DOWNLOAD_URL,
    finalUrl: DOWNLOAD_URL,
    referrer: REFERRER,
    filename: "/Users/me/Downloads/CSE406_Lec03.pdf",
    fileSize: 1234,
    mime: "application/octet-stream",
  };

  it("collects what the app needs", () => {
    const msg = buildDownloadMessage(item, TAB, "2026-10-03T00:00:00.000Z");
    expect(msg).toMatchObject({
      type: "download",
      filename: item.filename,
      contentId: "abc123",
      fileNameParam: "CSE406_Lec03.pdf",
      courseId: { referrer: "210208", tab: "210208", url: null },
      tab: {
        url: "https://learning.hanyang.ac.kr/courses/210208/modules",
        title: "소프트웨어공학",
      },
      startedAt: "2026-10-03T00:00:00.000Z",
      moduleItemId: null,
      lms: null,
    });
  });

  it("never carries the student id or any query string", () => {
    const text = JSON.stringify(buildDownloadMessage(item, TAB, ""));
    expect(text).not.toContain("2099000000");
    expect(text).not.toContain("user_id");
    expect(text).not.toContain("?");
  });

  it("passes the module item id and the LMS lookup through", () => {
    const tab = {
      url: "https://learning.hanyang.ac.kr/courses/210208/modules/items/8582053",
      title: "x",
    };
    const lms = { courseName: "소프트웨어공학", courseCode: "HY11171", week: null, error: null };
    const msg = buildDownloadMessage(item, tab, "", lms);
    expect(msg.moduleItemId).toBe("8582053");
    expect(msg.lms).toBe(lms);
  });

  it("works without tab information", () => {
    const msg = buildDownloadMessage(item, null, "");
    expect(msg.tab).toBeNull();
    expect(msg.courseId.tab).toBeNull();
  });
});
