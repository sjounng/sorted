import { useState } from "react";
import { api, type AssignChoice } from "../api";
import { t } from "../i18n";
import { ago } from "../format";
import { useLoad } from "../useLoad";
import { closeSelf } from "../windows";

const NEW = "__new__";

/** 과목을 알아내지 못한 파일에 과목을 고른다 (FR-5). 고른 답은 앱이 기억한다. */
export function Assign({ id }: { id: string }) {
  const { data } = useLoad(() => api.assignRequest(id), [id]);
  const [picked, setPicked] = useState<string>();
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!data) return <main className="dialog" />;

  const choice: AssignChoice | undefined =
    picked === NEW
      ? newName.trim()
        ? { newCourseName: newName.trim() }
        : undefined
      : picked
        ? { courseId: picked }
        : undefined;

  const save = async () => {
    if (!choice) return;
    setSaving(true);
    await api.assignCourse(data.fileId, choice).finally(() => setSaving(false));
    await closeSelf();
  };

  const skip = async () => {
    await api.skipAssign(data.fileId);
    await closeSelf();
  };

  return (
    <main className="dialog">
      <h1>{t("Which class is this for?", "어느 과목 자료인가요?")}</h1>
      <p className="file">
        <strong>{data.fileName}</strong>
        <span className="muted">
          {" "}
          · {t(`downloaded ${ago(data.atMs)}`, `${ago(data.atMs)} 받음`)}
        </span>
      </p>
      {data.tabTitle && (
        <p className="muted hint">
          {t("Page open at download:", "받을 때 열려 있던 페이지:")} {data.tabTitle}
        </p>
      )}

      <fieldset className="choices">
        {data.courses.map((c) => (
          <label key={c.id} className="choice">
            <input
              type="radio"
              name="course"
              checked={picked === c.id}
              onChange={() => setPicked(c.id)}
            />
            {c.name}
          </label>
        ))}
        <label className="choice">
          <input
            type="radio"
            name="course"
            checked={picked === NEW}
            onChange={() => setPicked(NEW)}
          />
          {t("New class", "새 과목")}
        </label>
        {picked === NEW && (
          <input
            className="text"
            autoFocus
            placeholder={t("Class name", "과목명")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        )}
      </fieldset>

      <p className="muted hint">
        {t(
          "Files from this class page will be sorted automatically next time.",
          "다음부터는 이 과목 페이지에서 받은 파일을 알아서 정리해요.",
        )}
      </p>

      <div className="actions">
        <button onClick={skip}>{t("Later", "나중에")}</button>
        <button className="primary" disabled={!choice || saving} onClick={save}>
          {t("Sort", "정리하기")}
        </button>
      </div>
    </main>
  );
}
