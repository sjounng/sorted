import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { detail, title, type Received } from "./messages";

const list = document.querySelector<HTMLOListElement>("#messages")!;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
let count = 0;

function show(item: Received) {
  const li = document.createElement("li");
  const head = document.createElement("strong");
  head.textContent = title(item);
  const sub = document.createElement("span");
  sub.textContent = detail(item);
  li.append(head, sub);
  if (item.source === "queued") li.classList.add("queued");
  list.prepend(li);

  count += 1;
  status.textContent = `받은 메시지 ${count}개`;
}

async function start() {
  // 새 메시지를 먼저 듣고, 그다음 지난 메시지를 가져온다. 순서를 바꾸면 사이에 온 메시지를 놓칠 수 있다.
  const seen = new Set<string>();
  const key = (r: Received) => `${r.receivedAtMs}:${JSON.stringify(r.message)}`;
  const showOnce = (r: Received) => {
    if (seen.has(key(r))) return;
    seen.add(key(r));
    show(r);
  };

  await listen<Received>("native-message", (event) => showOnce(event.payload));
  const past = await invoke<Received[]>("received_messages");
  past.forEach(showOnce);
}

start().catch((err) => {
  status.textContent = `앱 내부 연결 오류: ${String(err)}`;
});
