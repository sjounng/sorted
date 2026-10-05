// Sorted 확장의 서비스 워커.
//
// 1. 앱 연결 확인: 설치·Chrome 시작·아이콘 클릭 때 hello를 보낸다.
// 2. LMS 다운로드 감지: 다운로드가 끝나면 출처 정보와 LMS의 과목명·주차를 앱에 보낸다
//    (스파이크 #3, FR-1·FR-11·FR-12의 출발점).
// 3. 일정 (FR-19): LMS 탭이 열려 있을 때 한 시간에 한 번까지 플래너를 읽어 앱에 보낸다.
//    영상은 주차학습 페이지가 받은 응답을 weekly-page.js → weekly-bridge.js가 넘겨 주면 과목별로 보낸다.
//
// 결과는 아이콘 배지로 보여 준다.
//   OK  앱이 받음
//   Q   앱이 꺼져 있어 중계 프로그램이 보관해 둠 (앱이 켜지면 전달됨)
//   !   중계 프로그램을 찾지 못함 (scripts/install-native-host.sh 실행 필요)

import {
  LMS_ORIGIN,
  lookupCourse,
  lookupPlanner,
  moduleItemIdOf,
  parseCanvasJson,
  splitCourseName,
} from "./canvas.js";
import { buildDownloadMessage, courseIdOf, isLmsDownload, isLmsHost, queryParam } from "./lms.js";
import { byCourse, weeklyItems } from "./weekly.js";

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
chrome.action.onClicked.addListener(() => {
  hello("clicked");
  // 사용자가 직접 누르면 한 시간 제한 없이 일정을 다시 읽는다
  refreshSchedule({ force: true });
});

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
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(LMS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── 일정 (FR-19) ──────────────────────────────────────
// LMS에 새 요청을 만들므로 LMS가 열려 있을 때만, 한 시간에 한 번까지 읽는다 (기획안 "추가 요청 최소화").
// 확장은 쿠키·인증 토큰을 읽지 않는다. fetch가 로그인 쿠키를 실어 보낼 뿐이다.

const SCHEDULE_EVERY_MS = 60 * 60 * 1000;
/** LMS 요청 하나를 기다리는 최대 시간 */
const LMS_TIMEOUT_MS = 15 * 1000;

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

async function refreshSchedule({ force = false } = {}) {
  const { scheduleAt = 0 } = await chrome.storage.local.get("scheduleAt");
  if (!force && Date.now() - scheduleAt < SCHEDULE_EVERY_MS) return;
  // 실패해도 한 시간 동안은 다시 묻지 않는다 (로그아웃 상태에서 LMS를 계속 두드리지 않게)
  await chrome.storage.local.set({ scheduleAt: Date.now() });
  try {
    // 진행 상황만 남긴다 (내용은 남기지 않음)
    const items = await lookupPlanner(fetchPage, Date.now(), (step) =>
      console.info("[Sorted] 일정:", step),
    );
    // 주차학습 응답에는 과목명이 없어서, 플래너에서 본 과목명을 기억해 둔다
    const courseNames = Object.fromEntries(
      items.filter((i) => i.courseId && i.courseName).map((i) => [i.courseId, i.courseName]),
    );
    const { courseNames: known = {} } = await chrome.storage.local.get("courseNames");
    await chrome.storage.local.set({ courseNames: { ...known, ...courseNames } });
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
  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    // 응답이 없으면 기다리지 않는다 (과목 하나가 멈춰도 나머지는 계속)
    signal: AbortSignal.timeout(LMS_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { text: await res.text(), link: res.headers.get("Link") };
}

// ── 영상 일정 (FR-19) ──────────────────────────────────
// 주차학습 페이지가 받은 응답을 weekly-bridge.js가 넘긴다. LMS 페이지에서 온 것만 받는다.
// 주차학습은 과목 하나씩 열리므로 과목별 출처(weekly:<과목 ID>)로 보내, 앱이 다른 과목을 지우지 않게 한다.

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "weekly" || !Array.isArray(message.modules)) return;
  let host;
  try {
    host = new URL(sender.url ?? "").hostname;
  } catch {
    return;
  }
  if (sender.id !== chrome.runtime.id || !isLmsHost(host)) return;
  sendWeekly(message.modules);
});

async function sendWeekly(modules) {
  const { courseNames = {} } = await chrome.storage.local.get("courseNames");
  const fetchedAt = new Date().toISOString();
  for (const [courseId, raw] of byCourse(weeklyItems(modules, courseNames))) {
    // 기억해 둔 이름도 다듬는다 (예전 규칙으로 저장된 "202620HY_…" 같은 이름)
    const known = splitCourseName(courseNames[courseId] ?? "").name;
    const name = known || (await rememberCourseName(courseId, courseNames));
    const items = raw.map((i) => ({ ...i, courseName: name }));
    await sendToApp({ type: "schedule", source: `weekly:${courseId}`, items, fetchedAt });
  }
}

/** 처음 보는 과목이면 LMS에 과목명을 한 번 묻고 기억한다 (다운로드 때 과목명을 묻는 것과 같은 요청) */
async function rememberCourseName(courseId, courseNames) {
  try {
    const course = parseCanvasJson(
      await fetchText(`${LMS_ORIGIN}/api/v1/courses/${encodeURIComponent(courseId)}`),
    );
    const { name } = splitCourseName(course?.name);
    if (!name) return "";
    await chrome.storage.local.set({ courseNames: { ...courseNames, [courseId]: name } });
    return name;
  } catch {
    return "";
  }
}
