import { describe, expect, it } from "vitest";
import { assumptions, detail, title, type Probe, type Received } from "./messages";

const TZ = "Asia/Seoul";
const AT = Date.UTC(2026, 9, 1, 5, 3, 21); // 서울 14:03:21

const item = (over: Partial<Received> = {}): Received => ({
  id: 1,
  receivedAtMs: AT,
  source: "live",
  message: { type: "hello", reason: "clicked" },
  probe: null,
  ...over,
});

const probe = (over: Partial<Probe> = {}): Probe => ({
  name: "Lec03.pdf",
  contentId: "c1",
  courseId: { referrer: null, tab: "210208", url: null },
  tabTitle: "cse406-lec-00-v3",
  moduleItemId: null,
  lms: {
    courseName: "소프트웨어공학",
    courseCode: "HY11171",
    week: { name: "1주차", position: 1, matchedBy: "title" },
    error: null,
  },
  file: { readable: true, error: null, size: 2048, isPdf: true, sha256: "ab".repeat(32) },
  firstPage: { text: "Lecture 3 Requirements", error: null },
  previous: null,
  ...over,
});

const status = (p: Probe) => assumptions(p, TZ).map((r) => r.status);

describe("title", () => {
  it("shows type and reason", () => {
    expect(title(item())).toBe("hello · 확장 아이콘 클릭");
  });

  it("falls back when fields are missing or unknown", () => {
    expect(title(item({ message: {} }))).toBe("(종류 없음)");
    expect(title(item({ message: { type: "ping", reason: "???" } }))).toBe("ping");
  });

  it("names downloads by file", () => {
    const msg = { type: "download", filename: "/Users/me/Downloads/Lec03 (1).pdf" };
    expect(title(item({ message: msg }))).toBe("다운로드 · Lec03 (1).pdf");
    expect(title(item({ message: msg, probe: probe() }))).toBe("다운로드 · Lec03.pdf");
  });
});

describe("detail", () => {
  it("shows time only for live messages", () => {
    expect(detail(item(), TZ)).toBe("14:03:21");
  });

  it("marks queued messages", () => {
    expect(detail(item({ source: "queued" }), TZ)).toBe("14:03:21 · 앱이 꺼져 있는 동안 보관됨");
  });
});

describe("assumptions", () => {
  it("is empty while the probe is running", () => {
    expect(assumptions(null)).toEqual([]);
  });

  it("first download: 1·4·5 pass, 2·3 wait for a re-download", () => {
    expect(status(probe())).toEqual(["pass", "later", "later", "pass", "pass"]);
    expect(assumptions(probe(), TZ)[4].detail).toBe(
      "소프트웨어공학 · 1주차 (자료 제목으로 찾음)\n첫 페이지: Lecture 3 Requirements",
    );
  });

  it("re-download with the same id and bytes passes 2 and 3", () => {
    const p = probe({
      previous: { recordedAtMs: AT, contentId: "c1", contentIdSame: true, sha256Same: true },
    });
    expect(status(p)).toEqual(["pass", "pass", "pass", "pass", "pass"]);
    expect(assumptions(p, TZ)[1].detail).toBe("지난번(10/01 14:03) c1 → 이번 c1");
  });

  it("changed id or bytes fail 2 and 3", () => {
    const p = probe({
      contentId: "c2",
      previous: { recordedAtMs: AT, contentId: "c1", contentIdSame: false, sha256Same: false },
    });
    expect(status(p).slice(1, 3)).toEqual(["fail", "fail"]);
  });

  it("no course id from the tab fails 1", () => {
    expect(status(probe({ courseId: { referrer: "210208", tab: null, url: null } }))[0]).toBe(
      "fail",
    );
  });

  it("permission problems fail 4 with the reason", () => {
    const p = probe({
      file: {
        readable: false,
        error: "PermissionDenied: Operation not permitted",
        size: null,
        isPdf: null,
        sha256: null,
      },
    });
    const row = assumptions(p, TZ)[3];
    expect(row.status).toBe("fail");
    expect(row.detail).toContain("PermissionDenied");
  });

  it("fails 5 when the week or the whole lookup is missing", () => {
    const noWeek = probe({
      lms: { courseName: "소프트웨어공학", courseCode: null, week: null, error: null },
    });
    expect(assumptions(noWeek, TZ)[4]).toMatchObject({ status: "fail" });
    expect(assumptions(noWeek, TZ)[4].detail).toContain("주차를 못 찾음");

    const failed = probe({
      lms: { courseName: null, courseCode: null, week: null, error: "HTTP 401" },
    });
    expect(assumptions(failed, TZ)[4].detail).toContain("HTTP 401");
    expect(assumptions(probe({ lms: null }), TZ)[4].detail).toContain("과목 ID 없음");
  });

  it("reports a probe error as one failed row", () => {
    expect(assumptions({ error: "bad message" })).toEqual([
      { label: "확인 실패", status: "fail", detail: "bad message" },
    ]);
  });
});
