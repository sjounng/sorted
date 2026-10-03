# Sorted — 작업 안내 (Claude Code용)

LMS에서 받은 강의자료 PDF를 과목·주차별로 자동 정리하는 Chrome 확장 + Mac 메뉴 막대 앱.
CSE406 소프트웨어공학 Phase 1 프로젝트 (3분 대면 시연, 영어). 평가에서 도구 사용, git 이력, 이슈 추적을 본다.

- 대화는 **한국어**로 한다.
- 기획안(요구사항, 아키텍처, 일정): Claude Docs "Sorted 기획안"
  https://claude.ai/code/artifact/68de80c1-8330-47aa-9dab-9719871144e1
- 화면 ↔ 앱 내부 약속: `docs/app-api.md` / 연결 구조: `docs/native-messaging.md` / 스파이크 결과: `docs/spike-3.md`

## 팀과 맡은 부분

| 이름 | 맡은 부분                                                                                                       |
| ---- | --------------------------------------------------------------------------------------------------------------- |
| 예원 | 앱 화면 `app/src/` (TypeScript). **화면 코드는 건드리지 않는다.** 필요한 건 `docs/app-api.md`에 약속으로 적는다 |
| 준우 | 확장 `extension/`, 앱 내부 `app/src-tauri`, `app/core`, `app/native-host`                                       |

## 구조

```
extension/          Chrome MV3 확장. LMS 다운로드 감지, LMS(Canvas) API로 과목명·주차 조회 (canvas.js)
app/core/           판정 로직 (Rust, 화면 무관): course(과목 판정) judge(문서·버전) library(목록 저장)
                    organize(~/Sorted 이동) fingerprint(PDF·SHA-256) ipc/framing/queue/paths(통신)
app/native-host/    Chrome이 메시지마다 띄우는 중계 프로그램 → 유닉스 소켓 → 앱. 앱이 꺼져 있으면 pending.jsonl에 보관
app/src-tauri/      메뉴 막대 앱. pipeline(정리 흐름) organizer(상태·보류 목록) inbox probe(스파이크 #3 확인용)
app/src/            임시 디버그 화면 (예원 담당)
scripts/            install-native-host.sh / uninstall-native-host.sh
(server/)           판정 보조 서버 (선택, FR-18, 4단계 예정). Lambda + LLM. API 키는 여기에만 둔다
```

데이터: `~/Library/Application Support/Sorted/` (sorted.sock, pending.jsonl, library.json, probe-history.jsonl, logs/)
정리 폴더: `~/Sorted/<과목명>/<주차>/<원래 파일명>.pdf` (환경 변수 `SORTED_ROOT`로 바꿀 수 있음)

> **이 Mac에서는 `~/Sorted` = 저장소 `~/sorted`** (디스크가 대소문자를 구분하지 않음). 그대로 두면 강의 PDF가 저장소 안에 들어간다.
> 확인할 때는 `open --env SORTED_ROOT="$HOME/Documents/Sorted-test" app/target/release/bundle/macos/Sorted.app`로 띄운다.

## 확인 명령 (CI와 같음)

```sh
npm run format:check && npm run lint                         # 저장소 루트
cd app && npm run typecheck && npm test                      # 화면·확장 테스트 (vitest가 extension/도 돈다)
cd app && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```

실행:

```sh
./scripts/install-native-host.sh                            # 중계 프로그램 등록 (native-host 바뀌면 다시)
cd app && npm run tauri build -- --bundles app && open target/release/bundle/macos/Sorted.app
```

## 작업 규칙

- GitHub Flow: 이슈 → `feat/<이슈번호>-<이름>` 브랜치 → PR → CI 통과 → **merge commit**으로 합침 (squash 안 함, 이력 보존). 승인 필수 아님.
- PR 본문: `Closes #N` (끝난 것), `Refs #N` (일부만, 화면 쪽 남은 것). 커밋 메시지: `feat(core): …`, `fix(extension): …`, `docs: …`, 본문 끝에 `Refs #N`.
- 커밋 작성자는 준우(`sjounng`). Claude가 쓴 코드면 커밋 끝에 `Co-Authored-By: Claude <noreply@anthropic.com>`.
- 코드 주석·문서는 한국어. Prettier(printWidth 100)·rustfmt 적용 후 커밋.
- **개인정보:** 실제 강의 PDF, 학번, LMS URL의 쿼리(`?` 뒤), LMS API 응답의 user_id·수강 정보는 커밋·로그·이슈에 남기지 않는다. 확장은 앱에 보내기 전에 URL 쿼리를 지우고, 로그에는 메시지 내용을 남기지 않는다 (테스트로 확인 중).
  판정 보조 서버(FR-18)에는 파일명·첫 페이지 글자·후보 문서 이름만 보낸다 (PDF·학번·URL 안 보냄). 사용자 동의를 받고, 꺼도 동작해야 한다.
- 확실하지 않으면 파일에 손대지 않는다. 중복 파일은 묻기 전까지 지우거나 옮기지 않는다. 지울 땐 휴지통.

## 주의할 점

- zsh에서 큰따옴표 안의 `!`는 history expansion 에러가 난다. PR 본문은 작은따옴표나 `--body-file - <<'EOF'`로.
- `extension/`이 바뀌면 `chrome://extensions`에서 Sorted 새로고침해야 반영된다.
- 다운로드 폴더 권한(가정 4)은 `tauri dev`가 아니라 빌드한 `.app`으로 확인한다 (dev는 터미널 권한을 빌림).
- Sorted 앱은 하나만 뜰 수 있다 (소켓). 새로 띄우기 전에 메뉴 막대에서 종료.
- 확장 ID는 manifest의 `key`로 `phgmelpblnighkdkldoamokdbjbmencf` 고정.

## 이슈 번호

| 이슈                    | 내용                                                                                     | 단계 |
| ----------------------- | ---------------------------------------------------------------------------------------- | ---- |
| #1, #2(PR)              | 스파이크: 네이티브 메시징                                                                | 끝   |
| #3                      | 스파이크: 남은 가정 (과목 ID, content_id, 해시, 권한, 과목명·주차)                       | 끝   |
| #4~#9                   | FR-1 감지, FR-2 PDF만, FR-3 문서 식별, FR-4 버전, FR-5 과목 판정, FR-6 폴더 정리         | 2    |
| #14, #15, #18, #23      | FR-11 과목명, FR-12 주차 순서, FR-15 첫 설정, FR-17 모듈 밖 자료의 주차(게시일·start_at) | 2    |
| #10, #11, #16, #17, #19 | FR-7 중복 알림, FR-8 새 버전, FR-13 메뉴 막대, FR-14 파일 추적(xattr), FR-16 연결 끊김   | 3    |
| #12, #13, #24           | FR-9 변경 보여주기, FR-10 구버전 정리, FR-18 이름 바뀐 새 버전 찾기(판정 보조 서버)      | 4    |

## 지금 상태 (2026-10-03)

- `main`: 스파이크 #3(PR #21), 2단계 앱 내부(PR #22)까지 합쳐짐. 닫힌 이슈: #3 #4 #6 #7 #9 #14.
  남은 2단계: #5 #8 #15 #18(화면 쪽), #23(FR-17).
- 빌드한 앱으로 실제 LMS 자료가 `소프트웨어공학/2주차/`에 정리되고 `library.json`에 기록되는 것 확인 (테스트 폴더 사용).
- 작업한 브랜치(`feat/3-…`, `feat/9-…`)는 머지 후에도 지우지 않고 남겨 둔다.
- `feat/16-menubar-popover`: 예원의 메뉴 막대 화면 작업 (FR-13, 원격에서 진행 중).

## 다음 할 일

1. FR-17 (#23): 공지·과제 첨부의 게시일과 학기 시작일로 주차 계산, 못 찾으면 미분류. 모듈 주차가 우선.
2. 3단계 앱 내부 (준우): FR-14 파일 추적(xattr로 과목 ID·content_id 새기기, 옮긴 파일 따라가기), FR-16 실제 다운로드로 보관 확인,
   FR-7 중복 처리 명령(`resolve_duplicate`: 기존 파일 열기 → 받은 복사본 휴지통 / 둘 다 두기), FR-13용 목록 명령 보강. 명령을 추가하면 `docs/app-api.md`도 함께 고친다.
3. probe(스파이크 #3 확인 코드)는 2단계가 자리 잡으면 제거하고 디버그 화면도 정리 (화면은 예원과 상의).
4. README에 아키텍처 Mermaid 그림 넣기 (교수님 시연용).
5. 시연 전: 설계 문서 영어 번역.
