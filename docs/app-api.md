# 앱 화면 ↔ 앱 내부 약속

화면(`app/src/`)과 앱 내부(`app/src-tauri/`)가 주고받는 이벤트와 명령. 화면은 이 약속만 보고 만들면 된다.
바꿀 때는 이 문서와 `app/src-tauri/src/lib.rs`를 같은 PR에서 고친다.

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
```

## 이벤트

### `download-processed`

다운로드 하나의 정리가 끝날 때마다 온다.

```ts
listen<{ id: number; outcome: Outcome }>("download-processed", (e) => { … });
```

`id`는 받은 메시지 번호다 (`native-message` 이벤트의 `id`와 같음).

### `native-message`

확장에서 온 메시지 원본. 디버그 화면용. 정리 결과도 `outcome` 필드로 붙어서 다시 온다.

## `Outcome`

`kind`로 구분한다. 경로는 모두 절대 경로다.

| `kind`            | 필드                                | 뜻                                                 | 화면이 할 일 (기능 요구사항)                                       |
| ----------------- | ----------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `organized`       | `path`, `course`, `week`, `version` | `~/Sorted/<course>/<week>/`로 옮김                 | 알림. `version` ≥ 2면 "새 버전" (FR-8, 비교는 FR-9)                |
| `duplicate`       | `existing`, `downloaded`            | 같은 내용을 이미 가짐. 받은 파일은 그대로 둠       | "이미 있는 파일" 창: [기존 파일 열기] / [둘 다 두기] (FR-7, 3단계) |
| `needsCourse`     | `path`                              | 과목을 정하지 못함. 보류 목록에 들어감             | 과목 지정 창 → `assign_course` (FR-5)                              |
| `needsPermission` | `path`                              | 다운로드 폴더를 읽을 권한 없음. 보류 목록에 들어감 | 메뉴 막대에 [설정 열기] → `open_privacy_settings` (FR-15)          |
| `loginExpired`    | `path`                              | PDF 대신 웹 페이지가 받아짐                        | "LMS에 다시 로그인한 뒤 받아 주세요" 알림 (FR-2)                   |
| `notPdf`          | `path`                              | PDF가 아님. 손대지 않음                            | 표시하지 않아도 됨                                                 |
| `missing`         | `path`                              | 처리 전에 파일이 사라짐                            | 표시하지 않아도 됨                                                 |
| `error`           | `message`                           | 그 밖의 실패                                       | 메뉴 막대의 "처리하지 못한 파일"에 표시 (FR-13)                    |

## 명령

| 명령                    | 인자                                 | 돌려주는 것                       | 쓰는 곳                                      |
| ----------------------- | ------------------------------------ | --------------------------------- | -------------------------------------------- |
| `pending_downloads`     | 없음                                 | `{ id, outcome }[]`               | 메뉴 막대의 보류 목록 (FR-13)                |
| `assign_course`         | `{ id: number, courseName: string }` | `Outcome` 또는 `null`(없는 id)    | 과목 지정 창 (FR-5). 이후 같은 과목은 기억됨 |
| `retry_permission`      | 없음                                 | `[id, Outcome][]`                 | 권한을 허용하고 돌아왔을 때 (FR-15)          |
| `open_privacy_settings` | 없음                                 | 없음                              | [설정 열기] 버튼 (FR-15)                     |
| `library`               | 없음                                 | `Library` (아래)                  | 과목 목록, 최근 변경 (FR-13)                 |
| `sorted_root`           | 없음                                 | `string` (`~/Sorted`의 절대 경로) | "폴더 열기" 등                               |
| `received_messages`     | 없음                                 | 받은 메시지 목록                  | 디버그 화면                                  |

```ts
const out = await invoke<Outcome | null>("assign_course", { id: 7, courseName: "운영체제" });
```

## `Library`

```ts
interface Library {
  courses: { lmsId: string | null; name: string; codes: string[] }[];
  documents: {
    key:
      | { kind: "contentId" | "moduleItem"; value: string }
      | { kind: "name"; course: string; name: string };
    course: string;
    week: string;
    fileName: string;
    versions: { number: number; sha256: string; size: number; path: string; addedAtMs: number }[];
  }[];
}
```
