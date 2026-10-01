import { describe, expect, it } from "vitest";
import { detail, title, type Received } from "./messages";

const item = (over: Partial<Received> = {}): Received => ({
  receivedAtMs: Date.UTC(2026, 9, 1, 5, 3, 21),
  source: "live",
  message: { type: "hello", reason: "clicked" },
  ...over,
});

describe("title", () => {
  it("shows type and reason", () => {
    expect(title(item())).toBe("hello · 확장 아이콘 클릭");
  });

  it("falls back when fields are missing or unknown", () => {
    expect(title(item({ message: {} }))).toBe("(종류 없음)");
    expect(title(item({ message: { type: "ping", reason: "???" } }))).toBe("ping");
  });
});

describe("detail", () => {
  it("shows time only for live messages", () => {
    expect(detail(item(), "Asia/Seoul")).toBe("14:03:21");
  });

  it("marks queued messages", () => {
    expect(detail(item({ source: "queued" }), "Asia/Seoul")).toBe(
      "14:03:21 · 앱이 꺼져 있는 동안 보관됨",
    );
  });
});
