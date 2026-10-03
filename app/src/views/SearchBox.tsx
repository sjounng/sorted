import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Course, type CourseFile, type Overview } from "../api";
import { courseColor } from "../courseColor";

interface FileHit {
  file: CourseFile;
  course: Course;
  week: string;
}

type Hit = { kind: "class"; course: Course } | ({ kind: "file" } & FileHit);

const MAX_CLASSES = 4;
const MAX_FILES = 8;

/** 띄어쓰기·밑줄·하이픈·점·대소문자를 무시하고 비교한다 ("05 아키텍처" ↔ "05_아키텍처.pdf") */
function norm(text: string): string {
  return text.toLowerCase().replace(/[\s_\-.]+/g, "");
}

/**
 * 과목명과 파일 이름 검색. 과목을 누르면 그 과목 화면으로, 파일을 누르면 PDF를 연다.
 * 자료 목록은 처음 검색할 때 과목마다 course_detail로 읽고, 과목이 바뀌면 다시 읽는다.
 */
export function SearchBox(props: {
  data: Overview;
  onOpenCourse: (course: Course, color: string) => void;
}) {
  const { data, onOpenCourse } = props;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState<FileHit[]>();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // 과목 목록이 바뀌면(추가·이름 바꾸기·삭제) 자료 목록을 다시 읽는다
  const courseKey = data.courses.map((c) => `${c.id}:${c.name}:${c.fileCount}`).join("|");
  useEffect(() => setFiles(undefined), [courseKey]);

  useEffect(() => {
    if (!open || files) return;
    let alive = true;
    Promise.all(data.courses.map((c) => api.courseDetail(c.id).catch(() => undefined))).then(
      (details) => {
        if (!alive) return;
        setFiles(
          details.flatMap((d) =>
            d
              ? d.weeks.flatMap((w) =>
                  w.files.map((file) => ({ file, course: d.course, week: w.week })),
                )
              : [],
          ),
        );
      },
    );
    return () => {
      alive = false;
    };
  }, [open, files, data.courses]);

  // 바깥을 누르면 닫는다
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const hits: Hit[] = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const classes = data.courses
      .filter((c) => norm(c.name).includes(q) || norm(c.lmsTitle ?? "").includes(q))
      .slice(0, MAX_CLASSES)
      .map((course): Hit => ({ kind: "class", course }));
    const fileHits = (files ?? [])
      .filter((h) => norm(h.file.fileName).includes(q))
      .slice(0, MAX_FILES)
      .map((h): Hit => ({ kind: "file", ...h }));
    return [...classes, ...fileHits];
  }, [query, data.courses, files]);

  const choose = (hit: Hit) => {
    if (hit.kind === "class") {
      onOpenCourse(hit.course, courseColor(data.courses, hit.course.id));
    } else {
      api.openFile(hit.file.path);
    }
    setOpen(false);
    setQuery("");
    input.current?.blur();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      input.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      choose(hits[active]);
    }
  };

  const showList = open && query.trim() !== "";
  const classHits = hits.filter((h) => h.kind === "class");
  const fileHits = hits.filter((h) => h.kind === "file");

  return (
    <div className="search-box" ref={box}>
      <label className="search-input">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          placeholder="Search classes and files"
          aria-label="Search classes and files"
          aria-expanded={showList}
          aria-controls="search-results"
          aria-activedescendant={showList && hits[active] ? `sr-${active}` : undefined}
          role="combobox"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
        />
      </label>

      {showList && (
        <div className="search-results" id="search-results" role="listbox">
          {hits.length === 0 ? (
            <p className="sr-empty muted">
              {files ? `No classes or files match “${query.trim()}”.` : "Searching…"}
            </p>
          ) : (
            <>
              {classHits.length > 0 && <p className="sr-group">Classes</p>}
              {classHits.map((hit) => {
                const i = hits.indexOf(hit);
                const course = (hit as { course: Course }).course;
                return (
                  <button
                    key={`c-${course.id}`}
                    id={`sr-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "sr-item active" : "sr-item"}
                    style={
                      { "--course": courseColor(data.courses, course.id) } as React.CSSProperties
                    }
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(hit)}
                  >
                    <span className="course-dot" aria-hidden />
                    <span className="sr-text">
                      <strong>{course.name}</strong>
                      <span className="sr-meta">
                        {course.fileCount} files
                        {course.latestWeek ? ` · up to ${course.latestWeek}` : ""}
                      </span>
                    </span>
                  </button>
                );
              })}

              {fileHits.length > 0 && <p className="sr-group">Files</p>}
              {fileHits.map((hit) => {
                const i = hits.indexOf(hit);
                const { file, course, week } = hit as FileHit;
                return (
                  <button
                    key={`f-${file.id}`}
                    id={`sr-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className={i === active ? "sr-item active" : "sr-item"}
                    style={
                      { "--course": courseColor(data.courses, course.id) } as React.CSSProperties
                    }
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(hit)}
                    title="Open PDF"
                  >
                    <span className="sr-pdf" aria-hidden>
                      PDF
                    </span>
                    <span className="sr-text">
                      <strong>{file.fileName}</strong>
                      <span className="sr-meta">
                        {course.name} · {week}
                      </span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
