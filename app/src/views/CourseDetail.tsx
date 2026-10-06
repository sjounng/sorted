import { useEffect, useState } from "react";
import {
  api,
  type Annotation,
  type CourseFile,
  type ScheduleItem,
  type ScheduleKind,
} from "../api";
import { t } from "../i18n";
import { ago, size, startOfDay, weekLabel } from "../format";
import { useLoad } from "../useLoad";
import { openView } from "../windows";
import { dayLabel, filterLabel, ScheduleRow } from "./ScheduleView";

/** 과목 화면의 탭: 정리한 파일, 그리고 LMS 일정 종류별 */
type Tab = "files" | ScheduleKind;
const TABS: Tab[] = ["files", "assignment", "quiz", "video", "event"];

/** 과목 카드를 누르면 열리는 과목 화면. Files 탭은 주차별 자료, 나머지 탭은 그 과목의 LMS 일정. */
export function CourseDetail(props: {
  courseId: string;
  folder: string;
  color: string;
  onBack: () => void;
}) {
  const { courseId, folder, color, onBack } = props;
  const { data, error, reload } = useLoad(() => api.courseDetail(courseId), [courseId]);
  const schedule = useLoad(api.schedule);
  const [tab, setTab] = useState<Tab>("files");
  const [showDone, setShowDone] = useState(false);
  // 완료한 것은 숨긴다 (Schedule의 "Show completed"와 같음). 탭의 숫자도 보이는 것만 센다
  const items = (schedule.data?.items ?? []).filter(
    (i) => i.courseId === courseId && (showDone || !i.done),
  );
  const count = (k: Tab) =>
    k === "files" ? (data?.course.fileCount ?? 0) : items.filter((i) => i.kind === k).length;

  // 미리보기에서 필기하고 돌아오면 필기본 목록이 바뀌어 있으니 다시 불러온다
  useEffect(() => {
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
    // reload는 상태 갱신만 해서 처음 것을 계속 써도 된다
  }, []);

  return (
    <div className="course" style={{ "--course": color } as React.CSSProperties}>
      <div className="course-bar">
        <button className="link back" onClick={onBack}>
          ‹ {t("My Classes", "내 과목")}
        </button>
      </div>

      {error && <p className="empty warn">{error}</p>}
      {data && (
        <>
          <header className="course-head">
            <span className="course-cover" />
            <div className="course-titles">
              <strong className="card-title">{data.course.name}</strong>
              <span className="muted">
                {[
                  data.course.term,
                  t(`${data.course.fileCount} files`, `파일 ${data.course.fileCount}개`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <button className="course-folder" onClick={() => api.revealInFinder(folder)}>
              {t("Open Folder", "폴더 열기")}
            </button>
          </header>

          <div className="chips course-tabs" role="tablist" aria-label={t("Show", "보기")}>
            {TABS.map((k) => (
              <button
                key={k}
                role="tab"
                className={tab === k ? "chip active" : "chip"}
                aria-selected={tab === k}
                onClick={() => setTab(k)}
              >
                {k === "files" ? t("Files", "파일") : filterLabel(k)}
                <span className="chip-count">{count(k)}</span>
              </button>
            ))}
            {tab !== "files" && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                />
                {t("Show completed", "완료한 것도 보기")}
              </label>
            )}
          </div>

          {tab !== "files" && (
            <CourseSchedule
              kind={tab}
              items={items.filter((i) => i.kind === tab)}
              synced={schedule.data ? schedule.data.fetchedAtMs !== null : undefined}
              hiddenDone={
                showDone
                  ? 0
                  : (schedule.data?.items ?? []).filter(
                      (i) => i.courseId === courseId && i.kind === tab && i.done,
                    ).length
              }
              name={data.course.name}
              color={color}
            />
          )}

          {tab === "files" && data.weeks.length === 0 && (
            <p className="empty muted">
              {t(
                "No files yet. Download from the LMS or drop PDFs into this class folder.",
                "아직 파일이 없어요. LMS에서 받거나 이 과목 폴더에 PDF를 넣어 주세요.",
              )}
            </p>
          )}
          {tab === "files" &&
            data.weeks.map((w) => (
              <section key={w.week} className="week">
                <h2>
                  {weekLabel(w.week)}
                  <span className="muted">
                    {" "}
                    ·{" "}
                    {t(
                      `${w.files.length} ${w.files.length === 1 ? "file" : "files"}`,
                      `파일 ${w.files.length}개`,
                    )}
                  </span>
                </h2>
                <ul className="files">
                  {/* 같은 주차 안에서는 받은 순서대로: 먼저 받은 게 위, 늦게 받은 게 아래로 쌓인다 */}
                  {[...w.files]
                    .sort((a, b) => a.savedAtMs - b.savedAtMs)
                    .map((f) => (
                      <FileRow key={f.id} file={f} />
                    ))}
                </ul>
              </section>
            ))}
        </>
      )}
    </div>
  );
}

/**
 * 과목 화면의 일정 탭. 지난 것까지 마감 순으로 보여 준다 (영상은 주차 순서대로 쭉). 완료한 것은 고를 때만.
 * 누르면 LMS의 그 과제·퀴즈·영상으로 간다.
 */
function CourseSchedule(props: {
  kind: ScheduleKind;
  items: ScheduleItem[];
  synced: boolean | undefined;
  /** 완료해서 숨긴 수. 목록이 비었을 때 "다 끝냈어요"로 알린다 */
  hiddenDone: number;
  name: string;
  color: string;
}) {
  const { kind, items, synced, hiddenDone, name, color } = props;
  if (synced === undefined) return null;
  const now = Date.now();
  const sorted = [...items].sort((a, b) => a.dueAtMs - b.dueAtMs);

  if (sorted.length === 0) {
    return (
      <p className="empty muted">
        {!synced
          ? t(
              "No LMS schedule yet. Open the LMS in Chrome once and it will show up here.",
              "아직 LMS 일정을 불러오지 않았어요. Chrome에서 LMS를 한 번 열면 여기에 모여요.",
            )
          : hiddenDone > 0
            ? t(
                "All done here. Check “Show completed” to see them.",
                "다 끝냈어요. “완료한 것도 보기”를 켜면 보여요.",
              )
            : kind === "video"
              ? t(
                  "No videos yet. Open this class's weekly learning page in the LMS once.",
                  "아직 영상이 없어요. LMS에서 이 과목의 주차학습 페이지를 한 번 열어 주세요.",
                )
              : t("Nothing here.", "아직 없어요.")}
      </p>
    );
  }

  return (
    <section className="sched-list course-sched">
      <ul className="sched-rows">
        {sorted.map((item, i) => {
          const header = i === 0 || startOfDay(sorted[i - 1].dueAtMs) !== startOfDay(item.dueAtMs);
          return (
            <ScheduleRow
              key={item.id}
              item={item}
              now={now}
              name={name}
              color={color}
              dayHeader={header ? dayLabel(item.dueAtMs, now) : undefined}
            />
          );
        })}
      </ul>
    </section>
  );
}

function FileRow({ file }: { file: CourseFile }) {
  const notes = file.annotations;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();

  const openOriginal = async () => {
    try {
      setError(undefined);
      await api.openOriginal(file.documentId, file.version);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <li className="file-row">
      <button
        className="file-main"
        // 필기본이 있으면 받은 그대로의 원본을 연다 (필기본은 오른쪽 버튼으로)
        onClick={() => (notes.length > 0 ? openOriginal() : api.openFile(file.path))}
        title={notes.length > 0 ? t("Open the original", "원본 열기") : t("Open", "열기")}
      >
        <PdfIcon />
        <span className="file-text">
          <strong>{file.fileName}</strong>
          <span className="muted">
            {file.version > 1 && `v${file.version} · `}
            {size(file.sizeBytes)} · {ago(file.savedAtMs)}
          </span>
        </span>
      </button>
      {notes.length > 0 && (
        <button
          className={`notes-toggle${open ? " open" : ""}`}
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {notes.length === 1
            ? t("Annotated", "필기본")
            : t(`${notes.length} annotated`, `필기본 ${notes.length}개`)}
          <span className="chevron">›</span>
        </button>
      )}
      {file.unseenChange && (
        <button className="pill" onClick={() => openView("compare", file.documentId)}>
          {t("New version · See changes", "새 버전 · 바뀐 곳 보기")}
        </button>
      )}
      {error && <p className="file-error warn">{error}</p>}
      {open && (
        <ul className="annotations">
          {notes.map((n) => (
            <AnnotationRow key={n.number} file={file} note={n} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 필기본 하나: 누르면 열고, 연필 버튼으로 이름을 바꾼다 (빈 이름이면 "필기 N"으로) */
function AnnotationRow({ file, note }: { file: CourseFile; note: Annotation }) {
  const [label, setLabel] = useState(note.label);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string>();
  const fallback = t(`Annotated ${note.number}`, `필기 ${note.number}`);

  const save = async (name: string) => {
    setEditing(false);
    if (name.trim() === (label ?? "")) return;
    try {
      await api.renameAnnotation(file.documentId, file.version, note.number, name);
      setLabel(name.trim() || null);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <li>
      {editing ? (
        <input
          className="text annotation-name"
          autoFocus
          defaultValue={label ?? ""}
          placeholder={fallback}
          maxLength={60}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => save(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <button onClick={() => api.openFile(note.path)} title={note.fileName}>
          <strong>{label ?? fallback}</strong>
          <span className="muted">
            {note.fileName} · {t("edited", "고침")} {ago(note.modifiedAtMs)}
          </span>
        </button>
      )}
      {!editing && (
        <button
          className="annotation-rename"
          onClick={() => setEditing(true)}
          title={t("Rename", "이름 바꾸기")}
          aria-label={t("Rename", "이름 바꾸기")}
        >
          ✎
        </button>
      )}
      {error && <p className="warn">{error}</p>}
    </li>
  );
}

function PdfIcon() {
  return (
    <svg
      className="pdf"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <text
        x="12"
        y="17.5"
        fontSize="5.5"
        fontWeight="700"
        textAnchor="middle"
        stroke="none"
        fill="currentColor"
      >
        PDF
      </text>
    </svg>
  );
}
