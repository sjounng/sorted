import { api, type Change, type Course, type Overview } from "../api";
import { courseColor } from "../courseColor";
import { ago } from "../format";
import { openView } from "../windows";

const LABEL: Record<Change["kind"], (c: Change) => string> = {
  organized: () => "정리됨",
  newVersion: (c) => `새 버전 · ${c.changedPages ?? 0}장 변경`,
  duplicate: () => "이미 받은 파일",
};

/** 최근 변경 탭: 과목별로 묶어 보여 준다. 과목 순서는 과목 탭과 같다. */
export function ChangesByCourse(props: {
  data: Overview;
  onOpenCourse: (course: Course, color: string) => void;
}) {
  const { data, onOpenCourse } = props;

  const groups = data.courses
    .map((course) => ({
      course,
      color: courseColor(data.courses, course.name),
      changes: data.changes.filter((c) => c.courseName === course.name),
    }))
    .filter((g) => g.changes.length > 0);

  if (groups.length === 0) return <p className="empty muted">최근 변경이 없어요.</p>;

  return (
    <div className="stack">
      {groups.map(({ course, color, changes }) => {
        const newVersions = changes.filter((c) => c.kind === "newVersion").length;
        return (
          <section
            key={course.id}
            className="week"
            style={{ "--course": color } as React.CSSProperties}
          >
            <button className="group-head" onClick={() => onOpenCourse(course, color)}>
              <span className="group-title">
                <strong>{course.name}</strong>
                <span className="muted">
                  {changes.length}건 · {ago(changes[0].atMs)}
                </span>
              </span>
              {newVersions > 0 && <span className="pill">새 버전 {newVersions}</span>}
              <span className="chevron" aria-hidden>
                ›
              </span>
            </button>
            <ul className="files">
              {changes.map((c) => (
                <li key={c.id} className="file-row">
                  <button
                    className="file-main"
                    onClick={() =>
                      c.kind === "newVersion"
                        ? openView("compare", c.documentId)
                        : api.revealInFinder(`${data.sortedFolder}/${course.name}`)
                    }
                  >
                    <span className="file-text">
                      <strong>{c.fileName}</strong>
                      <span className="muted">
                        <span className={`tag ${c.kind}`}>{LABEL[c.kind](c)}</span>
                        {ago(c.atMs)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
