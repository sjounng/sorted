import { Fragment, useState } from "react";
import { api, type PageChange, type PageChangeKind } from "../api";
import { useLoad } from "../useLoad";
import { openView } from "../windows";

const KIND_LABEL: Record<PageChangeKind, string> = {
  modified: "수정",
  added: "추가",
  removed: "삭제",
};

const anchor = (c: PageChange, i: number) =>
  c.kind === "removed" ? `removed-${i}` : `page-${c.page}`;

/** 새 버전에서 바뀐 부분을 슬라이드 위에 강조해 보여 준다 (FR-9). */
export function Compare({ id }: { id: string }) {
  const { data, error } = useLoad(() => api.comparison(id), [id]);
  const [selected, setSelected] = useState<number>();

  if (error) return <p className="empty warn">{error}</p>;
  if (!data) return <main className="compare" />;

  const jump = (i: number) => {
    setSelected(i);
    document
      .getElementById(anchor(data.changes[i], i))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const changesOn = (page: number) =>
    data.changes
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.kind !== "removed" && c.page === page);
  const removedAfter = (page: number) =>
    data.changes
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.kind === "removed" && c.page === page);

  return (
    <main className="compare">
      <header className="compare-head">
        <div>
          <h1>{data.fileName}</h1>
          <span className="muted">
            {data.courseName} · v{data.oldVersion} → v{data.newVersion} · {data.changes.length}곳
            변경
          </span>
        </div>
        <button onClick={() => openView("cleanup", data.documentId)}>이전 버전 정리…</button>
      </header>

      <div className="compare-body">
        <nav className="sidebar">
          <ol>
            {data.changes.map((c, i) => (
              <li key={i}>
                <button
                  className={selected === i ? "change active" : "change"}
                  onClick={() => jump(i)}
                >
                  <span className={`kind ${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                  <span className="where">
                    {c.kind === "removed" ? `이전 ${c.oldPage}장` : `${c.page}장`}
                  </span>
                  <span className="summary">{c.summary}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section className="slides">
          {removedAfter(0).map(({ c, i }) => (
            <Removed key={`r${i}`} id={anchor(c, i)} change={c} active={selected === i} />
          ))}
          {data.pages.map((p) => {
            const here = changesOn(p.page);
            const added = here.some(({ c }) => c.kind === "added");
            const active = here.some(({ i }) => i === selected);
            return (
              <Fragment key={p.page}>
                <figure
                  id={`page-${p.page}`}
                  className={[
                    "slide",
                    here.length ? "changed" : "",
                    added ? "added" : "",
                    active ? "active" : "",
                  ].join(" ")}
                >
                  <div className="frame">
                    <img src={p.imageUrl} alt={`${p.page}장`} loading="lazy" />
                    {here.flatMap(({ c, i }) =>
                      c.regions.map((r, k) => (
                        <span
                          key={`${i}-${k}`}
                          className={`hl ${c.kind}`}
                          style={{
                            left: `${r.x * 100}%`,
                            top: `${r.y * 100}%`,
                            width: `${r.w * 100}%`,
                            height: `${r.h * 100}%`,
                          }}
                        />
                      )),
                    )}
                  </div>
                  <figcaption>
                    {p.page}장
                    {here.map(({ c, i }) => (
                      <span key={i} className={`kind ${c.kind}`}>
                        {KIND_LABEL[c.kind]}
                      </span>
                    ))}
                  </figcaption>
                </figure>
                {removedAfter(p.page).map(({ c, i }) => (
                  <Removed key={`r${i}`} id={anchor(c, i)} change={c} active={selected === i} />
                ))}
              </Fragment>
            );
          })}
        </section>
      </div>
    </main>
  );
}

function Removed({ id, change, active }: { id: string; change: PageChange; active: boolean }) {
  return (
    <div id={id} className={active ? "gone active" : "gone"}>
      <span className="kind removed">삭제</span> {change.summary}
    </div>
  );
}
