import { api, type CourseFile } from "../api";
import { ago, size } from "../format";
import { useLoad } from "../useLoad";
import { openView } from "../windows";

/** 과목 카드를 누르면 열리는 과목 화면: 주차별 자료 목록. */
export function CourseDetail(props: {
  courseId: string;
  folder: string;
  color: string;
  onBack: () => void;
}) {
  const { courseId, folder, color, onBack } = props;
  const { data, error } = useLoad(() => api.courseDetail(courseId), [courseId]);

  return (
    <div className="course" style={{ "--course": color } as React.CSSProperties}>
      <div className="course-bar">
        <button className="link back" onClick={onBack}>
          ‹ 과목
        </button>
      </div>

      {error && <p className="empty warn">{error}</p>}
      {data && (
        <>
          <header className="course-head">
            <div className="course-titles">
              <strong className="card-title">{data.course.name}</strong>
              <span className="card-sub">{data.course.lmsTitle}</span>
              <span className="muted">
                {data.course.term} · 파일 {data.course.fileCount}개
              </span>
            </div>
            <button onClick={() => api.revealInFinder(folder)}>폴더 열기</button>
          </header>

          {data.weeks.map((w) => (
            <section key={w.week} className="week">
              <h2>
                {w.week}
                <span className="muted"> · {w.files.length}개</span>
              </h2>
              <ul className="files">
                {w.files.map((f) => (
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

function FileRow({ file }: { file: CourseFile }) {
  return (
    <li className="file-row">
      <button className="file-main" onClick={() => api.openFile(file.path)} title="열기">
        <PdfIcon />
        <span className="file-text">
          <strong>{file.fileName}</strong>
          <span className="muted">
            {file.version > 1 && `v${file.version} · `}
            {size(file.sizeBytes)} · {ago(file.savedAtMs)}
          </span>
        </span>
      </button>
      {file.unseenChange && (
        <button className="pill" onClick={() => openView("compare", file.documentId)}>
          새 버전 · 변경 보기
        </button>
      )}
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
