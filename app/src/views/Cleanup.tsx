import { api, type CleanupChoice } from "../api";
import { size } from "../format";
import { useLoad } from "../useLoad";
import { closeSelf } from "../windows";

/** 새 버전을 확인한 뒤 구버전을 지울지 묻는다 (FR-10). */
export function Cleanup({ id }: { id: string }) {
  const { data } = useLoad(() => api.cleanupRequest(id), [id]);
  if (!data) return <main className="dialog" />;

  const choose = async (choice: CleanupChoice) => {
    await api.resolveCleanup(data.documentId, choice);
    await closeSelf();
  };

  return (
    <main className="dialog">
      <h1>이전 버전을 지울까요?</h1>
      <p className="file">
        <strong>{data.fileName}</strong>
        <span className="muted">
          {" "}
          · v{data.oldVersion} · {size(data.sizeBytes)}
        </span>
      </p>

      {data.hasAnnotations ? (
        <p className="callout warn">
          이 파일에 필기가 있는 것 같아요. 받은 뒤로 내용이 바뀌었어요. 지우기 전에 필기를 옮겨
          두세요.
        </p>
      ) : (
        <p className="muted">파일은 휴지통으로 가고, 비교용 데이터는 바로 지워져요.</p>
      )}

      <div className="actions">
        <button onClick={() => api.revealInFinder(data.oldPath)}>Finder에서 보기</button>
        <span className="spacer" />
        <button onClick={() => choose("keep")}>보관</button>
        <button
          className={data.hasAnnotations ? "danger" : "primary"}
          onClick={() => choose("delete")}
        >
          휴지통으로
        </button>
      </div>
    </main>
  );
}
