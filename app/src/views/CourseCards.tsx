import { api, type Change, type Course, type Overview } from "../api";
import { openView } from "../windows";

// LMS 대시보드의 과목 카드 색. 목록 순서대로 돌려 써서 8과목까지는 색이 겹치지 않는다.
const COLORS = [
  "#e0638f",
  "#4a9eb7",
  "#6f9c5b",
  "#9d82d6",
  "#5aa287",
  "#ad8b2f",
  "#d9774b",
  "#5b7fd6",
];

/** 과목 탭: LMS 대시보드처럼 과목을 카드로 보여 준다. 창 폭에 맞춰 한 줄에 1~여러 장. */
export function CourseCards({ data }: { data: Overview }) {
  if (data.courses.length === 0) {
    return (
      <p className="empty muted">아직 정리한 강의자료가 없어요. LMS에서 평소처럼 받아 보세요.</p>
    );
  }
  return (
    <ul className="cards">
      {data.courses.map((c, i) => (
        <CourseCard
          key={c.id}
          course={c}
          color={COLORS[i % COLORS.length]}
          newVersions={data.changes.filter(
            (ch) => ch.kind === "newVersion" && ch.courseName === c.name,
          )}
          onOpen={() => api.revealInFinder(`${data.sortedFolder}/${c.name}`)}
        />
      ))}
    </ul>
  );
}

function CourseCard(props: {
  course: Course;
  color: string;
  newVersions: Change[];
  onOpen: () => void;
}) {
  const { course, color, newVersions, onOpen } = props;
  const latest = newVersions[0];

  return (
    <li className="card" style={{ "--course": color } as React.CSSProperties}>
      <button className="card-main" onClick={onOpen} title={`${course.name} 폴더 열기`}>
        <span className="card-cover" />
        <span className="card-body">
          <strong className="card-title">{course.name}</strong>
          <span className="card-sub">{course.lmsTitle}</span>
          <span className="card-term">{course.term}</span>
        </span>
      </button>

      <div className="card-icons">
        <span className="icon-stat" title="정리한 파일">
          <FileIcon />
          {course.fileCount}
        </span>
        <span className="icon-stat" title="가장 최근 자료">
          <CalendarIcon />
          {course.latestWeek}
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
    </li>
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
