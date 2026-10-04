// Sorted 확장의 서비스 워커.
//
// 1. 앱 연결 확인: 설치·Chrome 시작·아이콘 클릭 때 hello를 보낸다.
// 2. LMS 다운로드 감지: 다운로드가 끝나면 출처 정보와 LMS의 과목명·주차를 앱에 보낸다
//    (스파이크 #3, FR-1·FR-11·FR-12의 출발점).
// 3. 일정 (FR-19): LMS 탭이 열려 있을 때 한 시간에 한 번까지 플래너를 읽어 앱에 보낸다.
//
// 결과는 아이콘 배지로 보여 준다.
//   OK  앱이 받음
//   Q   앱이 꺼져 있어 중계 프로그램이 보관해 둠 (앱이 켜지면 전달됨)
//   !   중계 프로그램을 찾지 못함 (scripts/install-native-host.sh 실행 필요)

import { lookupCourse, lookupPlanner, moduleItemIdOf } from "./canvas.js";
import { buildDownloadMessage, courseIdOf, isLmsDownload, isLmsHost, queryParam } from "./lms.js";

/** scripts/install-native-host.sh 가 등록하는 이름과 같아야 한다. */
const HOST = "dev.sorted.host";

const BADGE = {
  ok: { text: "OK", color: "#1a7f37" },
  queued: { text: "Q", color: "#b25000" },
  error: { text: "!", color: "#cf222e" },
};

async function sendToApp(message) {
  try {
    const reply = await chrome.runtime.sendNativeMessage(HOST, message);
    console.log("[Sorted] reply", message.type, reply);
    if (reply?.ok && reply.queued) await setBadge("queued");
    else if (reply?.ok) await setBadge("ok");
    else await setBadge("error");
  } catch (err) {
    // 중계 프로그램이 설치되지 않았거나, allowed_origins에 이 확장 ID가 없을 때
    console.warn("[Sorted] native host unreachable:", err?.message ?? err);
    await setBadge("error");
  }
}

async function setBadge(kind) {
  const { text, color } = BADGE[kind];
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

function hello(reason) {
  return sendToApp({
    type: "hello",
    reason,
    extensionVersion: chrome.runtime.getManifest().version,
    sentAt: new Date().toISOString(),
  });
}

chrome.runtime.onInstalled.addListener(() => hello("installed"));
chrome.runtime.onStartup.addListener(() => hello("startup"));
chrome.action.onClicked.addListener(() => hello("clicked"));

// ── 다운로드 감지 ──────────────────────────────────────
// 활성 탭은 다운로드가 "시작될 때" 기록한다. 끝날 때쯤엔 사용자가 다른 탭으로 옮겼을 수 있다.
// 서비스 워커는 다운로드 도중 잠들 수 있으므로 기록은 storage.session에 둔다.

const key = (id) => `download:${id}`;

chrome.downloads.onCreated.addListener(async (item) => {
  if (!isLmsDownload(item)) return;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await chrome.storage.session.set({
    [key(item.id)]: {
      startedAt: new Date().toISOString(),
      // url·title은 host_permissions에 맞는 탭(LMS)일 때만 Chrome이 알려 준다.
      tab: tab ? { url: tab.url ?? null, title: tab.title ?? null } : null,
    },
  });
});

chrome.downloads.onChanged.addListener(async (delta) => {
  const state = delta.state?.current;
  if (state !== "complete" && state !== "interrupted") return;

  const k = key(delta.id);
  const { [k]: started } = await chrome.storage.session.get(k);
  if (!started) return; // LMS 다운로드가 아님
  await chrome.storage.session.remove(k);
  if (state === "interrupted") return;

  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item) return;
  const lms = await lookupForDownload(item, started.tab);
  await sendToApp(buildDownloadMessage(item, started.tab, started.startedAt, lms));
});

/** 과목 ID로 LMS에 과목명과 주차를 물어본다 (FR-11, FR-12). 과목 ID를 모르면 null. */
function lookupForDownload(item, tab) {
  const courseId = courseIdOf(tab?.url) ?? courseIdOf(item.referrer);
  if (!courseId) return null;
  const fileName =
    queryParam(item.finalUrl || item.url, "file_name") ?? item.filename.split("/").pop();
  return lookupCourse(fetchText, courseId, { moduleItemId: moduleItemIdOf(tab?.url), fileName });
}

/** 사용자의 LMS 로그인 쿠키를 실어 GET한다. host_permissions에 있는 도메인만 가능하다. */
async function fetchText(url) {
  const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── 일정 (FR-19) ──────────────────────────────────────
// LMS에 새 요청을 만들므로 LMS가 열려 있을 때만, 한 시간에 한 번까지 읽는다 (기획안 "추가 요청 최소화").
// 확장은 쿠키·인증 토큰을 읽지 않는다. fetch가 로그인 쿠키를 실어 보낼 뿐이다.

const SCHEDULE_EVERY_MS = 60 * 60 * 1000;

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.status !== "complete" || !tab.url) return;
  let host;
  try {
    host = new URL(tab.url).hostname;
  } catch {
    return;
  }
  if (isLmsHost(host)) refreshSchedule();
});

async function refreshSchedule() {
  const { scheduleAt = 0 } = await chrome.storage.local.get("scheduleAt");
  if (Date.now() - scheduleAt < SCHEDULE_EVERY_MS) return;
  // 실패해도 한 시간 동안은 다시 묻지 않는다 (로그아웃 상태에서 LMS를 계속 두드리지 않게)
  await chrome.storage.local.set({ scheduleAt: Date.now() });
  try {
    const items = await lookupPlanner(fetchPage, Date.now());
    await sendToApp({
      type: "schedule",
      source: "planner",
      items,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    // 내용은 남기지 않는다
    console.warn("[Sorted] 일정을 읽지 못함:", err?.message ?? err);
  }
}

/** 쿠키를 실어 GET하고 본문과 다음 쪽(Link 헤더)을 돌려준다. */
async function fetchPage(url) {
  const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), link: res.headers.get("Link") };
}
