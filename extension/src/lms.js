import { moduleItemIdOf } from "./canvas.js";

// LMS 다운로드에서 필요한 정보만 뽑아내는 순수 함수들. Chrome API를 쓰지 않아 테스트하기 쉽다.
//
// 개인정보: LMS URL의 쿼리에는 학번(user_id)이 들어 있을 수 있다.
// 그래서 필요한 값(content_id, 과목 ID 등)만 꺼낸 뒤, 앱에 넘기는 URL은 쿼리를 모두 지운다.

/** 한양대 LMS 도메인인가 (hycms.hanyang.ac.kr, learning.hanyang.ac.kr 등) */
export function isLmsHost(host) {
  return host === "hanyang.ac.kr" || host.endsWith(".hanyang.ac.kr");
}

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hostOf(url) {
  return parse(url)?.hostname ?? "";
}

/** 다운로드 URL이나 다운로드를 시작한 페이지(referrer)가 LMS면 LMS 다운로드로 본다. */
export function isLmsDownload(item) {
  return [item.url, item.finalUrl, item.referrer].some((u) => u && isLmsHost(hostOf(u)));
}

/** 쿼리와 해시를 지운 URL. 학번 같은 값이 남지 않는다. */
export function withoutQuery(url) {
  const u = parse(url);
  return u ? `${u.origin}${u.pathname}` : "";
}

/** URL 쿼리의 값 하나. 없으면 null. */
export function queryParam(url, name) {
  return parse(url)?.searchParams.get(name) ?? null;
}

/**
 * URL 어디에든 들어 있는 `courses/<숫자>`의 숫자.
 * referrer는 과목 주소를 인코딩해서 쿼리에 품고 있는 경우가 있어, 여러 번 풀어 가며 찾는다.
 */
export function courseIdOf(url) {
  if (!url) return null;
  let text = url;
  for (let i = 0; i < 3; i++) {
    const m = text.match(/courses\/(\d+)/);
    if (m) return m[1];
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return null;
}

/**
 * 앱에 보낼 다운로드 메시지.
 * @param item  chrome.downloads.DownloadItem (다운로드 완료 시점)
 * @param tab   다운로드가 시작될 때의 활성 탭 { url, title } 또는 null
 * @param startedAt 다운로드가 시작된 시각 (ISO 문자열)
 * @param lms   canvas.js lookupCourse의 결과 (과목명·주차) 또는 null
 */
export function buildDownloadMessage(item, tab, startedAt, lms = null) {
  const sourceUrl = item.finalUrl || item.url;
  return {
    type: "download",
    filename: item.filename,
    fileSize: item.fileSize,
    mime: item.mime,
    url: withoutQuery(sourceUrl),
    referrer: withoutQuery(item.referrer),
    contentId: queryParam(sourceUrl, "content_id"),
    fileNameParam: queryParam(sourceUrl, "file_name"),
    courseId: {
      referrer: courseIdOf(item.referrer),
      tab: courseIdOf(tab?.url),
      url: courseIdOf(sourceUrl),
    },
    tab: tab ? { url: withoutQuery(tab.url), title: tab.title ?? null } : null,
    moduleItemId: moduleItemIdOf(tab?.url),
    lms,
    startedAt,
    completedAt: new Date().toISOString(),
  };
}
