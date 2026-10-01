// Sorted 확장의 서비스 워커.
//
// 지금은 앱과 연결되는지만 확인한다: 설치·Chrome 시작·아이콘 클릭 때 hello를 보내고,
// 결과를 아이콘 배지로 보여 준다.
//   OK  앱이 받음
//   Q   앱이 꺼져 있어 중계 프로그램이 보관해 둠 (앱이 켜지면 전달됨)
//   !   중계 프로그램을 찾지 못함 (scripts/install-native-host.sh 실행 필요)
//
// 다운로드 감지(FR-1)는 이후 이슈에서 여기에 붙인다.

/** scripts/install-native-host.sh 가 등록하는 이름과 같아야 한다. */
const HOST = "dev.sorted.host";

const BADGE = {
  ok: { text: "OK", color: "#1a7f37" },
  queued: { text: "Q", color: "#b25000" },
  error: { text: "!", color: "#cf222e" },
};

async function hello(reason) {
  const message = {
    type: "hello",
    reason,
    extensionVersion: chrome.runtime.getManifest().version,
    sentAt: new Date().toISOString(),
  };
  try {
    const reply = await chrome.runtime.sendNativeMessage(HOST, message);
    console.log("[Sorted] reply", reply);
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

chrome.runtime.onInstalled.addListener(() => hello("installed"));
chrome.runtime.onStartup.addListener(() => hello("startup"));
chrome.action.onClicked.addListener(() => hello("clicked"));
