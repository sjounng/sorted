# 확장 ↔ 앱 통신

## 구조

```
Chrome 확장 ──sendNativeMessage──▶ Chrome ──stdin/stdout──▶ sorted-native-host ──유닉스 소켓──▶ Sorted 앱
                                        (메시지마다 새로 띄움)            │ 앱이 꺼져 있으면
                                                                          ▼
                                                                   pending.jsonl 에 보관
                                                                   (앱이 켜질 때 전달, FR-16)
```

**왜 중계 프로그램이 따로 있나.** Chrome은 네이티브 메시징 요청마다 매니페스트에 적힌 프로그램을 _새 프로세스로_ 띄운다. 메뉴 막대에 계속 떠 있는 앱에 직접 붙을 수 없으므로, 작은 중계 프로그램이 받아서 앱에 넘긴다. 중계 프로그램은 외부 크레이트 없이 표준 라이브러리만 써서 빨리 뜬다.

**왜 localhost 서버가 아니라 유닉스 소켓인가.** 네트워크 포트를 열지 않으므로 웹 페이지나 다른 기기가 접근할 수 없다. 소켓은 본인만 열 수 있는 폴더(`~/Library/Application Support/Sorted`, 0700) 안에 있고, 소켓 파일도 0600이다. Chrome 쪽은 호스트 매니페스트의 `allowed_origins`로 우리 확장만 중계 프로그램을 부를 수 있다.

## 메시지 규칙

| 구간        | 형식                                                   |
| ----------- | ------------------------------------------------------ |
| 확장 ↔ 중계 | 4바이트 길이(시스템 바이트 순서) + JSON. 응답 최대 1MB |
| 중계 ↔ 앱   | 한 줄에 JSON 하나. 요청 한 줄 → 응답 한 줄             |
| 보관 파일   | 한 줄에 JSON 하나 (JSON Lines), 최대 5MB               |

응답

- `{"ok":true,"app":"Sorted","version":"0.1.0"}`: 앱이 받음
- `{"ok":true,"queued":true}`: 앱이 꺼져 있어 보관함
- `{"ok":false,"error":"..."}`: 실패

## 개인정보

중계 프로그램 로그(`~/Library/Application Support/Sorted/logs/native-host.log`)에는 시각, 크기, 성공 여부만 남는다. 메시지 내용은 남기지 않는다. 다운로드 URL에 학번이 들어 있을 수 있기 때문이다. 이 규칙은 테스트(`native-host/tests/relay.rs`)로 확인한다.

## 스파이크 확인 순서 (이슈 #1)

1. `cd app && npm install && npm run tauri dev`: 메뉴 막대에 아이콘이 생기고 창이 뜬다.
2. `./scripts/install-native-host.sh`
3. `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램 로드" → `extension/`. ID가 `phgmelpblnighkdkldoamokdbjbmencf`인지 확인한다.
4. 확장 아이콘 클릭 → 배지 `OK`, 앱 창에 "hello · 확장 아이콘 클릭"이 뜬다.
5. 앱을 메뉴 막대에서 종료 → 확장 아이콘 클릭 → 배지 `Q`.
6. 앱을 다시 실행 → 창에 "앱이 꺼져 있는 동안 보관됨" 항목이 뜬다.
7. `./scripts/uninstall-native-host.sh` → 확장 아이콘 클릭 → 배지 `!`.

| 단계 | 결과 | 메모 |
| ---- | ---- | ---- |
| 1    |      |      |
| 2    |      |      |
| 3    |      |      |
| 4    |      |      |
| 5    |      |      |
| 6    |      |      |
| 7    |      |      |

## 문제가 생기면

- 배지 `!`: `chrome://extensions`에서 Sorted의 "서비스 워커"를 눌러 콘솔을 본다. `Specified native messaging host not found`면 2단계를 다시, `Access to the specified native messaging host is forbidden`이면 확장 ID와 매니페스트의 `allowed_origins`를 비교한다.
- 앱이 바로 꺼짐: 다른 Sorted 앱이 이미 떠 있으면 소켓을 열지 못한다. 메뉴 막대에서 다른 Sorted를 종료한다.
- 중계 프로그램 쪽 기록: `tail -f ~/Library/Application\ Support/Sorted/logs/native-host.log`
