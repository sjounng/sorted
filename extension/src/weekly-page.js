// 주차학습 페이지 안에서 돈다 (content script, world: "MAIN"). FR-19 영상 일정.
//
// 페이지가 받는 주차 목록 응답(`…modules?include_detail=true`)만 복사해 weekly-bridge.js로 넘긴다.
// 페이지의 요청·응답은 그대로 두고(복사본만 읽음), 새 요청을 만들지 않고, 쿠키·토큰은 읽지 않는다.
// 무슨 일이 있어도 예외를 밖으로 던지지 않아 LMS 페이지가 깨지지 않게 한다.
(() => {
  const WANTED = /include_detail=true/;

  const pass = (text) => {
    try {
      const body = JSON.parse(String(text).replace(/^\s*while\(1\);/, ""));
      if (Array.isArray(body)) window.postMessage({ sorted: "weekly", body }, location.origin);
    } catch {
      // 모양이 다르면 넘기지 않는다
    }
  };

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "");
      if (WANTED.test(url) || WANTED.test(response.url)) {
        response
          .clone()
          .text()
          .then(pass)
          .catch(() => {});
      }
    } catch {
      // 복사하지 못해도 페이지에는 원래 응답을 그대로 준다
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (WANTED.test(String(url))) {
        this.addEventListener("load", () => {
          try {
            if (this.responseType === "" || this.responseType === "text") pass(this.responseText);
            else if (this.responseType === "json") pass(JSON.stringify(this.response));
          } catch {
            // 무시
          }
        });
      }
    } catch {
      // 무시
    }
    return originalOpen.call(this, method, url, ...rest);
  };
})();
