import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { STATUS_TEXT, assumptions, detail, title, type Received } from "./messages";

const list = document.querySelector<HTMLOListElement>("#messages")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const shown = new Map<number, HTMLLIElement>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function render(item: Received): HTMLLIElement {
  const li = el("li", undefined, item.source === "queued" ? "queued" : undefined);
  li.append(el("strong", title(item)), el("span", detail(item)));

  if (item.message.type === "download") {
    const rows = assumptions(item.probe);
    if (rows.length === 0) {
      li.append(el("p", "파일 확인 중…", "pending"));
    } else {
      const table = el("dl", undefined, "checks");
      for (const row of rows) {
        table.append(
          el("dt", row.label),
          el("dd", STATUS_TEXT[row.status], `badge ${row.status}`),
          el("dd", row.detail, "why"),
        );
      }
      li.append(table);
    }
  }
  return li;
}

/** 같은 id면 자리를 지키며 바꾸고, 새 항목이면 맨 위에 넣는다. */
function upsert(item: Received) {
  const next = render(item);
  const prev = shown.get(item.id);
  if (prev) prev.replaceWith(next);
  else list.prepend(next);
  shown.set(item.id, next);
  status.textContent = `받은 메시지 ${shown.size}개`;
}

async function start() {
  // 새 메시지를 먼저 듣고, 그다음 지난 메시지를 가져온다. 순서를 바꾸면 사이에 온 메시지를 놓칠 수 있다.
  await listen<Received>("native-message", (event) => upsert(event.payload));
  const past = await invoke<Received[]>("received_messages");
  // 듣기 시작한 뒤 이미 더 새로운 상태로 들어온 항목은 덮어쓰지 않는다.
  past.filter((item) => !shown.has(item.id)).forEach(upsert);
}

start().catch((err) => {
  status.textContent = `앱 내부 연결 오류: ${String(err)}`;
});
