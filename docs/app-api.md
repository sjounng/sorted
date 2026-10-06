# 앱 화면 ↔ 앱 내부 약속

화면(`app/src/`)과 앱 내부(`app/src-tauri/`)가 주고받는 이벤트·명령·데이터 모양. **기준은 이 문서**다.
화면의 `app/src/api/types.ts`(데이터)와 `backend.ts`(명령)는 이 문서를 TypeScript로 옮긴 것이다 (PR #20).

- 바꿀 때는 이 문서, `types.ts`·`backend.ts`, `app/src-tauri/src/lib.rs`를 같은 PR에서 고친다.
- Rust 구조체는 `#[serde(rename_all = "camelCase")]`로 아래 모양에 맞춘다. 인자는 Tauri가 camelCase → snake_case로 바꿔 준다 (`fileId` → `file_id`).
- 경로는 모두 절대 경로, 시각은 Unix 밀리초(`…AtMs`)다.
- `id`·`documentId`·`fileId` 같은 ID는 항상 영문·숫자·`_`·`-`만 쓴다. 화면이 대화 창 이름(`<화면>-<id>`)으로 쓰기 때문이다. 파일명으로 식별하는 문서도 앱 내부가 해시 등으로 바꿔 준다.

앱은 Dock에 뜨는 보통 앱이다. 메인 창을 닫아도 뒤에서 돌며 다운로드를 받고, Dock 아이콘을 누르면 다시 열린다. 종료는 ⌘Q.

## 상태 표시

| 표시   | 뜻                                                          |
| ------ | ----------------------------------------------------------- |
| 있음   | 앱 내부에 이미 있고 이 모양 그대로다                        |
| 바꿈   | 비슷한 명령이 있지만 이름·인자·반환을 이 문서에 맞춰야 한다 |
| 새로   | 앱 내부에 아직 없다                                         |
| 개발용 | 화면 `Backend`에는 없고 "개발 → 메시지 기록" 창만 쓴다      |

## 이벤트

| 이벤트               | 실어 보내는 것                     | 언제                                                         | 상태   |
| -------------------- | ---------------------------------- | ------------------------------------------------------------ | ------ |
| `overview-changed`   | 없음                               | 메인 창 데이터(`Overview`)가 바뀔 때마다. 화면은 다시 부른다 | 있음   |
| `download-processed` | `{ id: number; outcome: Outcome }` | 다운로드 하나의 정리가 끝날 때마다                           | 있음   |
| `settings-changed`   | `Settings`                         | 언어 등 설정이 바뀔 때. 열린 창마다 받아 문구를 바꾼다       | 있음   |
| `native-message`     | 확장에서 온 메시지 원본            | 메시지를 받을 때마다. 정리 결과도 `outcome`으로 다시 온다    | 개발용 |

## 명령

### 메인 창 (FR-13)

| 명령       | 인자 | 돌려주는 것 | 단계 | 상태 |
| ---------- | ---- | ----------- | ---- | ---- |
| `overview` | 없음 | `Overview`  | 3    | 있음 |

### 과목 (FR-11, FR-12)

| 명령            | 인자                                 | 돌려주는 것    | 뜻                                                    | 단계 | 상태 |
| --------------- | ------------------------------------ | -------------- | ----------------------------------------------------- | ---- | ---- |
| `course_detail` | `{ courseId: string }`               | `CourseDetail` | 과목의 자료 전체, 주차는 LMS 순서대로                 | 3    | 있음 |
| `add_course`    | `{ name: string }`                   | `Course`       | 과목을 직접 추가. 정리 폴더에 같은 이름의 폴더가 생김 | 3    | 있음 |
| `rename_course` | `{ courseId: string; name: string }` | 없음           | 과목명(= 폴더 이름)을 바꿈. 과목 ID와 자료는 그대로   | 3    | 있음 |
| `remove_course` | `{ courseId: string }`               | 없음           | Sorted 휴지통으로. 자료는 그대로 두어 되살릴 수 있음  | 3    | 있음 |

### Sorted 휴지통

| 명령             | 인자                   | 돌려주는 것       | 뜻                                                                      | 단계 | 상태 |
| ---------------- | ---------------------- | ----------------- | ----------------------------------------------------------------------- | ---- | ---- |
| `trash`          | 없음                   | `TrashedCourse[]` | 휴지통에 있는 과목                                                      | 3    | 있음 |
| `restore_course` | `{ courseId: string }` | 없음              | 되살림. 같은 이름의 과목이 이미 있으면 거절                             | 3    | 있음 |
| `purge_course`   | `{ courseId: string }` | 없음              | 휴지통에서 지움. 과목 폴더는 macOS 휴지통으로 (Finder에서 꺼낼 수 있음) | 3    | 있음 |
| `empty_trash`    | 없음                   | 없음              | 휴지통의 과목 전부 `purge_course`                                       | 3    | 있음 |

- 과목명은 화면(`validate.ts`)과 같은 규칙으로 한 번 더 검사한다. 정리 폴더에 같은 이름의 폴더가 이미 있으면 이름 바꾸기를 거절한다 (합치지 않음).
- `rename_course`: 과목 폴더 이름을 바꾸므로 안의 파일이 함께 옮겨지고, 목록의 경로·최근 변경의 과목명도 고친다. 직접 만든 과목은 처음 ID를 저장해 두어 이름을 바꿔도 ID가 그대로다.
- `remove_course`: 화면에서만 숨긴다 (과목 카드·과목 화면·최근 변경). 그 과목으로 새로 받은 자료는 그대로 정리되지만 보이지 않는다.
- `purge_course`·`empty_trash`: 정리 폴더 바로 아래의 과목 폴더만 macOS 휴지통으로 보낸다. 휴지통에 든 과목만 지울 수 있다.

### 설정 (#46)

| 명령           | 인자                         | 돌려주는 것 | 뜻                                              | 단계 | 상태 |
| -------------- | ---------------------------- | ----------- | ----------------------------------------------- | ---- | ---- |
| `settings`     | 없음                         | `Settings`  | 지금 설정                                       | -    | 있음 |
| `set_language` | `{ language: "ko" \| "en" }` | `Settings`  | 언어를 바꾸고 저장. `settings-changed`를 보낸다 | -    | 있음 |

- 언어는 앱 데이터 폴더의 `settings.json`에 저장한다. 처음 켜면 macOS 언어를 따른다 (한국어면 `ko`, 아니면 `en`).
- 앱 내부가 만드는 문구(명령이 거절할 때의 이유, 앱이 띄우는 창 제목)도 이 언어를 따른다. 언어를 바꾸면 열린 대화 창 제목도 바뀐다.

### 일정 (FR-19, #30)

| 명령              | 인자              | 돌려주는 것 | 뜻                              | 단계 | 상태 |
| ----------------- | ----------------- | ----------- | ------------------------------- | ---- | ---- |
| `schedule`        | 없음              | `Schedule`  | 확장이 LMS에서 읽어 둔 일정     | 3    | 있음 |
| `open_in_browser` | `{ url: string }` | 없음        | LMS 페이지 등을 기본 브라우저로 | 3    | 있음 |

- `schedule`: 확장이 보낸 일정을 출처별로 덮어써 앱 데이터 폴더의 `schedule.json`에 둔 것. 모든 출처를 마감 순으로 합쳐 돌려준다. `fetchedAtMs`는 앱이 마지막으로 받은 시각.
  - `planner`: 과제·퀴즈·점수가 있는 토론·화상 강의 (모든 수강 과목). LMS 탭이 열려 있을 때 한 시간에 한 번까지, 또는 확장 아이콘을 누르면 바로 읽는다. 과제·퀴즈의 `lateUntilMs`는 과목마다 과제 목록을 한 번씩 받아 제출이 닫히는 시각(`lock_at`)으로 채운다 (플래너에는 없음).
  - `weekly:<과목 ID>`: 주차학습 영상. 사용자가 그 과목의 주차학습 페이지를 열면 페이지가 받은 응답에서 읽는다 (새 요청 없음). 과목마다 따로 덮어써 다른 과목은 남는다. `startAtMs`는 열림, `lateUntilMs`는 지각 인정 마감(`late_at`).
  - 플래너는 로그인한 사람이 수강하는 과목만 돌려준다. 영상은 과목마다 주차학습을 한 번은 열어야 들어온다.
- `open_in_browser`: `https://`이고 한양대 도메인(`hanyang.ac.kr`, `*.hanyang.ac.kr`)인 주소만 연다.

### 첫 실행 설정 (FR-15)

| 명령                       | 인자 | 돌려주는 것   | 뜻                                                                   | 단계 | 상태 |
| -------------------------- | ---- | ------------- | -------------------------------------------------------------------- | ---- | ---- |
| `setup_status`             | 없음 | `SetupStatus` | 권한·정리 폴더·확장 연결 상태                                        | 2    | 있음 |
| `request_downloads_access` | 없음 | `SetupStatus` | 다운로드 폴더를 한 번 읽어 권한 창을 띄우고, 보류된 파일을 다시 처리 | 2    | 있음 |
| `open_system_settings`     | 없음 | 없음          | 시스템 설정 → 개인정보 보호 → 파일 및 폴더                           | 2    | 있음 |

설정 창은 **앱 내부가 띄운다** (창 이름 `setup`): 앱을 켤 때 아직 설정을 끝낸 적이 없을 때, 그리고 다운로드를 처리하다 권한이 없을 때(`needsPermission`). `setup_status`가 세 가지(권한 허용, 정리 폴더, 확장 연결)를 모두 돌려주면 설정을 끝낸 것으로 보고 앱 데이터 폴더에 `setup-done`을 남긴다. 설정 창이 열려 있는 동안 확장이 연결되거나 다운로드가 처리되면 앱이 그 창을 새로 고쳐 상태를 다시 불러오게 한다.

`downloadsAccess`: macOS는 권한 창을 띄우지 않고 상태만 물어볼 방법이 없다. 그래서 앱이 **마지막으로 다운로드 폴더를 실제로 읽었을 때**의 결과다. 앱을 켠 뒤 아직 읽어 본 적이 없으면 `unknown`이고, `request_downloads_access`를 부르면 확인된다 (처음이면 권한 창이 뜨고 답할 때까지 기다린다). `extensionConnected`는 이번 실행에서 확장 메시지를 하나라도 받았는지다 (앱이 꺼져 있던 동안 보관된 것 포함).

### 파일 열기

| 명령               | 인자               | 돌려주는 것 | 뜻                                       | 단계 | 상태 |
| ------------------ | ------------------ | ----------- | ---------------------------------------- | ---- | ---- |
| `open_file`        | `{ path: string }` | 없음        | PDF를 기본 앱(미리보기 등)으로           | 3    | 있음 |
| `reveal_in_finder` | `{ path: string }` | 없음        | Finder에서 그 파일·폴더를 선택해 보여 줌 | 3    | 있음 |

두 명령 모두 정리 폴더 안(정리 폴더 자신 포함)의 경로만 받는다. 밖이거나 없는 경로는 이유를 담아 거절한다.

### 과목 지정 (FR-5)

| 명령             | 인자                                       | 돌려주는 것     | 뜻                                      | 단계 | 상태 |
| ---------------- | ------------------------------------------ | --------------- | --------------------------------------- | ---- | ---- |
| `assign_request` | `{ fileId: string }`                       | `AssignRequest` | 과목 지정 창에 보여 줄 것               | 2    | 있음 |
| `assign_course`  | `{ fileId: string; choice: AssignChoice }` | 없음            | 과목을 정해 정리. 이후 같은 과목은 기억 | 2    | 있음 |
| `skip_assign`    | `{ fileId: string }`                       | 없음            | 정하지 않고 다운로드 폴더에 그대로 둠   | 2    | 있음 |

- `fileId`는 보류 목록의 번호를 문자열로 쓴 것이다 (`overview.unprocessed[].id`와 같음).
- `assign_course`: 정리되거나(`organized`) 이미 있는 파일(`duplicate`)이면 성공. 파일이 사라졌거나 권한이 없으면 이유를 담아 거절한다. 새 과목명은 화면(`validate.ts`)과 같은 규칙으로 한 번 더 검사한다.
- `skip_assign`: 보류 목록에서만 빼고 파일은 다운로드 폴더에 그대로 둔다.
- 명령이 실패하면 `invoke`가 한국어 이유 문자열로 거절된다 (화면에 그대로 보여 줘도 된다).

### 중복 (FR-7)

| 명령                | 인자                                      | 돌려주는 것       | 뜻                                                               | 단계 | 상태 |
| ------------------- | ----------------------------------------- | ----------------- | ---------------------------------------------------------------- | ---- | ---- |
| `duplicate_notice`  | `{ id: string }`                          | `DuplicateNotice` | "이미 받은 파일이에요" 창에 보여 줄 것                           | 3    | 있음 |
| `resolve_duplicate` | `{ id: string; choice: DuplicateChoice }` | 없음              | `openExisting`: 기존 파일 열고 받은 복사본은 휴지통 / `keepBoth` | 3    | 있음 |

- 중복 안내 창은 **앱 내부가 띄운다**: 정리 결과가 `duplicate`이면 바로 `index.html?view=duplicate&id=<id>` 창(이름 `duplicate-<id>`)을 연다. `id`는 받은 메시지 번호다.
- `openExisting`: 기존 파일을 기본 앱으로 열고, 방금 받은 복사본은 macOS 휴지통으로 보낸다 (되살릴 수 있음). 보내기 전에 받은 파일이 정리 폴더 밖에 있고 내용(SHA-256)이 기존 버전과 지금도 같은지 다시 확인하고, 아니면 이유를 담아 거절한다.
- `keepBoth`: 아무것도 지우지 않는다. 받은 파일은 다운로드 폴더에 그대로 남는다.
- 기존 파일을 사용자가 옮겼으면 새 위치를 따라간다 (FR-14). 중복 기록은 앱이 켜져 있는 동안만 기억한다.

### 변경 비교·구버전 정리 (FR-9, FR-10)

| 명령              | 인자                                            | 돌려주는 것      | 뜻                                                           | 단계 | 상태 |
| ----------------- | ----------------------------------------------- | ---------------- | ------------------------------------------------------------ | ---- | ---- |
| `comparison`      | `{ documentId: string }`                        | `Comparison`     | 가장 최근 두 버전의 비교                                     | 4    | 새로 |
| `cleanup_request` | `{ documentId: string }`                        | `CleanupRequest` | 구버전 정리 창에 보여 줄 것                                  | 4    | 새로 |
| `resolve_cleanup` | `{ documentId: string; choice: CleanupChoice }` | 없음             | `delete`: 구버전을 휴지통으로, 비교용 데이터도 지움 / `keep` | 4    | 새로 |

### 없앤 명령

화면이 새 명령으로 옮겨 가서 없앴다: `pending_downloads`·`library`·`sorted_root` → `overview`·`course_detail`, `retry_permission` → `request_downloads_access`, `open_privacy_settings` → `open_system_settings`.
`received_messages`는 개발용 메시지 기록 창이 쓰므로 그대로 둔다.

### `overview`·`course_detail` 동작

- `changes`: 정리할 때마다 남기는 기록. 앱 데이터 폴더의 `history.json`에 최근 200개까지 남아 앱을 다시 켜도 보인다. 새것부터 온다.
- `unprocessed`: 과목을 기다리는 파일(`unknownCourse`)과 PDF가 아님·로그인 만료·옮기기 실패. 앱이 켜져 있는 동안만 기억한다 (보류 목록과 같음).
- `trashCount`: 휴지통이 아직 없어 0.
- `course_detail`: 주차는 `N주차`를 숫자 순서로, 숫자 없는 이름은 그 뒤 가나다순, `미분류`는 맨 끝. 같은 주차 안에서는 받은 순서. 문서의 버전마다 파일 하나다.
- 옮긴 파일 (FR-14): 앱이 정리한 파일에는 속성(xattr `dev.sorted.doc`)이 붙는다. 사용자가 정리 폴더 안에서 옮기거나 이름을 바꾸면 앱이 따라가고, 다른 `<과목>/<주차>/` 폴더로 옮겼으면 목록의 과목·주차도 그 폴더를 따른다. 정리 폴더 밖으로 옮기거나 지운 파일은 `overview`·`course_detail`에서 빠진다 (해시는 남김). 다시 넣으면 10초 안에 다시 보인다.
- `restored: true`: 사라졌던 버전과 같은 내용을 다시 받아 그 문서가 있던 과목·주차에 다시 정리했다. 최근 변경에는 `organized`로 남는다 (새 버전 아님). 평소에는 이 필드가 없다.
- 문서 ID: `cid-<content_id>`, `item-<모듈 항목 번호>`, 파일명으로 식별한 문서는 `name-<해시>`. 파일 ID는 `<문서 ID>-v<버전>`.

## `Outcome`

다운로드 하나를 정리한 결과. `download-processed` 이벤트로 온다. `kind`로 구분한다.
화면은 이것을 직접 보여 주기보다 `overview`의 `changes`·`unprocessed`로 본다.

| `kind`            | 필드                                             | 뜻                                                 | `overview`에서                                                    |
| ----------------- | ------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------------------- |
| `organized`       | `path`, `course`, `week`, `version`, `restored`? | `~/Sorted/<course>/<week>/`로 옮김                 | `changes`: `version`이 1이면 `organized`, 2 이상이면 `newVersion` |
| `duplicate`       | `existing`, `downloaded`                         | 같은 내용을 이미 가짐. 받은 파일은 그대로 둠       | `changes`: `duplicate` → 중복 창 (FR-7)                           |
| `needsCourse`     | `path`                                           | 과목을 정하지 못함. 보류 목록에 들어감             | `unprocessed`: `unknownCourse` → 과목 지정 창 (FR-5)              |
| `needsPermission` | `path`                                           | 다운로드 폴더를 읽을 권한 없음. 보류 목록에 들어감 | `setup_status.downloadsAccess`가 `denied` (FR-15)                 |
| `loginExpired`    | `path`                                           | PDF 대신 웹 페이지가 받아짐                        | `unprocessed`: `loginExpired` (FR-2)                              |
| `notPdf`          | `path`                                           | PDF가 아님. 손대지 않음                            | `unprocessed`: `notPdf`                                           |
| `missing`         | `path`                                           | 처리 전에 파일이 사라짐                            | 보여 주지 않음                                                    |
| `error`           | `message`                                        | 그 밖의 실패 (옮기기 실패 등)                      | `unprocessed`: `moveFailed`                                       |

## 데이터 모양

### 메인 창

```ts
/** 메인 창 전체 (FR-13) */
interface Overview {
  sortedFolder: string;
  courses: Course[];
  /** Sorted 휴지통에 있는 과목 수 */
  trashCount: number;
  /** 최근 변경. 새것부터 */
  changes: Change[];
  /** 판정하지 못해 다운로드 폴더에 그대로 둔 파일 */
  unprocessed: Unprocessed[];
}

interface Course {
  /** LMS 과목 ID (courses/<ID>). 사용자가 직접 추가한 과목은 `local-` + 과목명 해시 12자리 */
  id: string;
  /** 폴더 이름으로 쓰는 과목명. 사용자가 바꿀 수 있다. 예: "소프트웨어공학" */
  name: string;
  /** LMS의 원래 과목 이름. 직접 추가한 과목은 없다. 예: "202620HY11171_소프트웨어공학" (아직 비어 옴) */
  lmsTitle?: string;
  /** 예: "2026년 2학기" (아직 확장이 보내지 않아 "") */
  term: string;
  /** 과목 폴더 안의 PDF 수 */
  fileCount: number;
  /** 가장 최근에 받은 자료의 주차. 예: "5주차". 자료가 없으면 "" */
  latestWeek: string;
}

type ChangeKind = "organized" | "newVersion" | "duplicate";

interface Change {
  id: string;
  kind: ChangeKind;
  documentId: string;
  courseId: string;
  courseName: string;
  fileName: string;
  /** kind가 newVersion일 때 바뀐 장 수 (4단계 전에는 없음) */
  changedPages?: number;
  atMs: number;
}

type UnprocessedReason = "unknownCourse" | "notPdf" | "loginExpired" | "moveFailed";

interface Unprocessed {
  /** assign_request·skip_assign의 fileId */
  id: string;
  fileName: string;
  reason: UnprocessedReason;
  atMs: number;
}
```

### 과목·휴지통

```ts
/** 과목 하나의 자료 전체. 주차는 LMS 순서대로 1주차부터 */
interface CourseDetail {
  course: Course;
  weeks: WeekGroup[];
}

interface WeekGroup {
  /** 예: "5주차", "미분류" */
  week: string;
  /** LMS 게시 순서 */
  files: CourseFile[];
}

/** 정리 폴더에 있는 강의자료 하나 */
interface CourseFile {
  id: string;
  /** 같은 문서의 버전들은 documentId가 같다 (content_id 등 문서 키) */
  documentId: string;
  fileName: string;
  path: string;
  /** 1이면 처음 받은 그대로. 새 버전이면 2, 3, … */
  version: number;
  sizeBytes: number;
  savedAtMs: number;
  /** 새 버전이 왔는데 아직 변경 비교를 열어 보지 않았다 */
  unseenChange: boolean;
  /**
   * 사용자가 받은 뒤 파일을 고쳤다 (필기 등). 앱이 처음 받은 그대로의 사본을 따로 보관하고,
   * 지금 파일의 SHA-256이 받은 때와 다르면 true. 화면을 열 때 수정 시각·크기가 바뀐 파일만 다시 잰다
   */
  annotated: boolean;
}

/** 되살리면 자료·최근 변경과 함께 돌아온다 */
interface TrashedCourse {
  course: Course;
  removedAtMs: number;
}
```

### 일정 (FR-19, #30)

```ts
type ScheduleKind = "assignment" | "quiz" | "video" | "event";

interface Schedule {
  items: ScheduleItem[];
  /** 마지막으로 LMS에서 읽은 시각. 아직 못 읽었으면 null */
  fetchedAtMs: number | null;
}

/** 확장이 LMS에서 읽어 앱에 넘긴다. 과제·퀴즈·화상 강의는 Canvas 플래너, 영상은 주차학습에서 온다 */
interface ScheduleItem {
  id: string;
  kind: ScheduleKind;
  /** LMS 과목 ID. Sorted 과목과 같으면 그 과목 이름으로 보여 준다 */
  courseId: string;
  /** LMS의 과목 이름 (Sorted에 없는 과목일 때 쓴다) */
  courseName: string;
  title: string;
  /** 마감 시각. 화상 강의는 시작 시각 */
  dueAtMs: number;
  /** 영상: 볼 수 있게 열리는 시각 */
  startAtMs?: number;
  /**
   * 마감 뒤에도 늦게 해서 인정받을 수 있는 마지막 시각. 없으면 지각 인정 없음.
   * 영상은 주차학습 late_at, 과제·퀴즈는 제출이 닫히는 lock_at (플래너 응답엔 없어 과제 정보에서 따로 읽는다)
   */
  lateUntilMs?: number;
  /** 제출함 / 시청 완료 */
  done: boolean;
  /** LMS에서 이 항목을 여는 주소 (쿼리 없이) */
  url: string;
}
```

### 설정

```ts
type Language = "ko" | "en";

interface Settings {
  language: Language;
}
```

### 첫 실행 설정

```ts
type Permission = "granted" | "denied" | "unknown";

/** FR-15 */
interface SetupStatus {
  downloadsAccess: Permission;
  sortedFolder: string;
  sortedFolderCreated: boolean;
  /** 확장에서 hello를 받은 적이 있다 */
  extensionConnected: boolean;
}
```

### 과목 지정·중복

```ts
/** 과목을 알아내지 못한 파일 (FR-5) */
interface AssignRequest {
  fileId: string;
  fileName: string;
  /** 다운로드할 때 보던 탭 제목. 과목을 고르는 단서 */
  tabTitle?: string;
  atMs: number;
  courses: Course[];
}

type AssignChoice = { courseId: string } | { newCourseName: string };

/** 같은 문서·같은 내용을 다시 받았을 때 (FR-7) */
interface DuplicateNotice {
  id: string;
  fileName: string;
  courseName: string;
  week: string;
  existingPath: string;
  existingSavedAtMs: number;
}

type DuplicateChoice = "openExisting" | "keepBoth";
```

### 변경 비교·구버전 정리

```ts
/** 새 버전 변경 비교 (FR-9) */
interface Comparison {
  documentId: string;
  fileName: string;
  courseName: string;
  oldVersion: number;
  newVersion: number;
  pages: PageImage[];
  changes: PageChange[];
}

interface PageImage {
  page: number;
  /** 앱이 만들어 둔 페이지 이미지. convertFileSrc로 바꿀 수 있는 경로 */
  imageUrl: string;
}

type PageChangeKind = "modified" | "added" | "removed";

interface PageChange {
  kind: PageChangeKind;
  /** 새 버전의 장 번호. removed면 삭제된 장 바로 앞에 오는 새 버전의 장 (맨 앞이면 0) */
  page: number;
  /** removed일 때 이전 버전의 장 번호 */
  oldPage?: number;
  summary: string;
  /** 새 버전 슬라이드에서 강조할 부분. added면 비워 두고 장 전체를 강조 */
  regions: Region[];
}

/** 0~1 비율 좌표. 슬라이드 이미지 크기와 상관없다 */
interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 구버전 정리 (FR-10) */
interface CleanupRequest {
  documentId: string;
  fileName: string;
  oldVersion: number;
  oldPath: string;
  sizeBytes: number;
  /** 받을 때의 해시와 달라졌으면 필기가 있다고 본다 */
  hasAnnotations: boolean;
}

type CleanupChoice = "delete" | "keep";
```

## 앱 내부에서 새로 필요한 것

화면 약속을 채우려면 지금 `library.json`·확장 메시지에 없는 정보가 필요하다.

| 필요한 것                          | 어디에 쓰나                      | 할 일                                                                              |
| ---------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| 과목의 학기(`term`), LMS 원래 이름 | `Course.term`, `Course.lmsTitle` | 확장이 `courses/<ID>?include[]=term`으로 받아 보내고, 목록에 저장                  |
| 최근 변경 기록                     | `Overview.changes`               | 정리할 때마다 기록을 남긴다 (지금은 `Outcome`을 이벤트로만 보냄)                   |
| 비교를 열어 봤는지                 | `CourseFile.unseenChange`        | `comparison`을 부르면 본 것으로 기록                                               |
| Sorted 휴지통                      | `trash` 등                       | 과목에 "지운 시각"을 두고 목록에서 숨긴다                                          |
| 확장 연결 여부                     | `SetupStatus.extensionConnected` | `hello`를 받은 적이 있는지 기록                                                    |
| 일정                               | `schedule`                       | 확장이 Canvas 플래너·주차학습에서 읽어 새 메시지(`schedule`)로 보낸다 (FR-19, #30) |

## 정할 것

- **변경 비교 (FR-9, 4단계):** 화면은 앱이 만든 페이지 이미지와 0~1 비율 좌표의 강조 영역을 받는다고 가정했다. 기획안의 "비교용 페이지 이미지·지문"과 맞다. 4단계에서 렌더링 방식을 정할 때 이 모양을 지킬 수 있는지 확인한다.
- **영상 일정 (FR-19, 정함):** 과제·퀴즈·시험·화상 강의는 확장이 Canvas 플래너 API를 조회하고(한 시간에 한 번까지), 주차학습 영상은 사용자가 연 주차학습 페이지가 받은 응답을 확장이 읽는다. 확장은 쿠키·인증 토큰을 읽지 않는다. 앱은 일정을 출처(플래너 / 주차학습)별로 덮어써 저장해, 한쪽이 갱신될 때 다른 쪽이 지워지지 않게 한다.
