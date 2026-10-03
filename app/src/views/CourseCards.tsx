import { useEffect, useRef, useState } from "react";
import { api, courseNameProblem, type Change, type Course, type Overview } from "../api";
import { courseColor } from "../courseColor";
import { openView } from "../windows";

/**
 * 과목 탭: LMS 대시보드처럼 과목을 카드로 보여 준다. 창 폭에 맞춰 한 줄에 1~여러 장.
 * 카드의 ⋮에서 이름을 바꾸거나 지우고, 마지막 + 칸에서 과목을 추가한다.
 */
export function CourseCards(props: {
  data: Overview;
  onSelect: (course: Course, color: string) => void;
}) {
  const { data, onSelect } = props;
  return (
    <ul className="cards">
      {data.courses.map((c) => (
        <CourseCard
          key={c.id}
          course={c}
          courses={data.courses}
          color={courseColor(data.courses, c.id)}
          newVersions={data.changes.filter(
            (ch) => ch.kind === "newVersion" && ch.courseId === c.id,
          )}
          onOpen={() => onSelect(c, courseColor(data.courses, c.id))}
        />
      ))}
      <AddCard courses={data.courses} />
    </ul>
  );
}

type Mode = "view" | "menu" | "rename" | "confirmDelete";

function CourseCard(props: {
  course: Course;
  courses: Course[];
  color: string;
  newVersions: Change[];
  onOpen: () => void;
}) {
  const { course, courses, color, newVersions, onOpen } = props;
  const latest = newVersions[0];
  const [mode, setMode] = useState<Mode>("view");
  const [error, setError] = useState<string>();
  const card = useRef<HTMLLIElement>(null);

  // 메뉴는 카드 바깥을 누르거나 Esc를 누르면 닫는다.
  useEffect(() => {
    if (mode !== "menu") return;
    const close = (e: Event) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !card.current?.contains(e.target as Node)
      ) {
        setMode("view");
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [mode]);

  const rename = async (name: string) => {
    if (name.trim() === course.name) return setMode("view");
    try {
      await api.renameCourse(course.id, name);
      setMode("view");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const remove = async () => {
    try {
      await api.removeCourse(course.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <li ref={card} className="card" style={{ "--course": color } as React.CSSProperties}>
      {mode === "rename" ? (
        <div className="card-main">
          <span className="card-cover" />
          <div className="card-body">
            <NameForm
              initial={course.name}
              courses={courses}
              exceptId={course.id}
              submitLabel="저장"
              hint="정리 폴더 안의 과목 폴더 이름도 같이 바뀌어요."
              serverError={error}
              onSubmit={rename}
              onCancel={() => {
                setError(undefined);
                setMode("view");
              }}
            />
          </div>
        </div>
      ) : (
        <button className="card-main" onClick={onOpen} title={`${course.name} 자료 보기`}>
          <span className="card-cover" />
          <span className="card-body">
            <strong className="card-title">{course.name}</strong>
            <span className="card-sub">{course.lmsTitle ?? "직접 추가한 과목"}</span>
            <span className="card-term">{course.term}</span>
          </span>
        </button>
      )}

      {mode !== "rename" && (
        <button
          className="kebab"
          aria-label={`${course.name} 메뉴`}
          aria-expanded={mode === "menu"}
          onClick={() => setMode(mode === "menu" ? "view" : "menu")}
        >
          <KebabIcon />
        </button>
      )}
      {mode === "menu" && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => setMode("rename")}>
            이름 바꾸기
          </button>
          <button role="menuitem" className="danger-text" onClick={() => setMode("confirmDelete")}>
            삭제
          </button>
        </div>
      )}

      {mode === "confirmDelete" ? (
        <div className="card-confirm">
          <p>
            <strong>{course.name}</strong>을(를) 지울까요?
            <br />
            <span className="muted">
              {course.fileCount > 0
                ? `자료 ${course.fileCount}개와 함께 휴지통으로 옮겨요. 휴지통에서 되살릴 수 있어요.`
                : "휴지통으로 옮겨요. 휴지통에서 되살릴 수 있어요."}
            </span>
          </p>
          {error && <p className="warn">{error}</p>}
          <div className="actions">
            <button onClick={() => setMode("view")}>취소</button>
            <button className="danger" onClick={remove}>
              휴지통으로
            </button>
          </div>
        </div>
      ) : (
        <div className="card-icons">
          <span className="icon-stat" title="정리한 파일">
            <FileIcon />
            {course.fileCount}
          </span>
          <span className="icon-stat" title="가장 최근 자료">
            <CalendarIcon />
            {course.latestWeek || "자료 없음"}
          </span>
          {latest && (
            <button
              className="icon-btn"
              title={`새 버전: ${latest.fileName}`}
              onClick={() => openView("compare", latest.documentId)}
            >
              <RefreshIcon />
              <span className="dot">{newVersions.length}</span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** 대시보드 마지막 칸: 누르면 과목명 입력 칸으로 바뀐다. */
function AddCard({ courses }: { courses: Course[] }) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();

  const add = async (name: string) => {
    try {
      await api.addCourse(name);
      setAdding(false);
      setError(undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!adding) {
    return (
      <li className="card add-card">
        <button className="add-main" onClick={() => setAdding(true)}>
          <span className="plus" aria-hidden>
            +
          </span>
          과목 추가
        </button>
      </li>
    );
  }

  return (
    <li className="card add-card adding">
      <div className="card-body">
        <strong className="add-title">새 과목</strong>
        <NameForm
          initial=""
          courses={courses}
          submitLabel="추가"
          hint="정리 폴더에 같은 이름의 과목 폴더가 생겨요."
          serverError={error}
          onSubmit={add}
          onCancel={() => {
            setAdding(false);
            setError(undefined);
          }}
        />
      </div>
    </li>
  );
}

/** 과목명 입력: 폴더 이름 규칙을 입력하는 동안 바로 보여 준다. Enter 저장, Esc 취소. */
function NameForm(props: {
  initial: string;
  courses: Course[];
  exceptId?: string;
  submitLabel: string;
  hint: string;
  serverError?: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initial);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const problem = courseNameProblem(name, props.courses, props.exceptId);
  const shown = (touched && problem) || props.serverError;

  return (
    <form
      className="name-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setTouched(true);
        if (problem || saving) return;
        setSaving(true);
        await props.onSubmit(name).finally(() => setSaving(false));
      }}
    >
      <input
        className="text"
        autoFocus
        placeholder="과목명"
        value={name}
        aria-invalid={Boolean(shown)}
        onChange={(e) => {
          setName(e.target.value);
          setTouched(true);
        }}
        onKeyDown={(e) => e.key === "Escape" && props.onCancel()}
        onFocus={(e) => e.target.select()}
      />
      <p className={shown ? "field-error" : "field-hint muted"}>{shown || props.hint}</p>
      <div className="actions">
        <button type="button" onClick={props.onCancel}>
          취소
        </button>
        <button type="submit" className="primary" disabled={Boolean(problem) || saving}>
          {props.submitLabel}
        </button>
      </div>
    </form>
  );
}

function KebabIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

const iconProps = {
  width: 22,
  height: 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function FileIcon() {
  return (
    <svg {...iconProps}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4" />
    </svg>
  );
}
