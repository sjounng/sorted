// weekly-page.js(페이지 안)가 넘긴 주차 목록 응답을 백그라운드로 전달한다 (content script, 격리된 영역).
// 페이지 안의 스크립트는 확장 API를 쓸 수 없어서 이 다리를 거친다. 같은 창·같은 주소에서 온 것만 받는다.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.sorted !== "weekly" || !Array.isArray(data.body)) return;
  chrome.runtime.sendMessage({ type: "weekly", modules: data.body }).catch(() => {});
});
