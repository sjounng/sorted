import type { ScheduleItem } from "./api";

// 마감이 지났는데 안 한 일정
// - 지각 인정 중(late · still open): 아직 하면 인정된다. Schedule 맨 위와 Dashboard 띠로 알린다.
// - 그 밖(지각 인정 없음·끝남): 할 수 있는 게 없으니 목록에서 뺀다. 달력에서 그날을 고르면 보인다.

function pastDue(item: ScheduleItem, now: number): boolean {
  return !item.done && item.kind !== "event" && item.dueAtMs < now;
}

/** 마감은 지났지만 지각 인정 기한(영상 late_at, 과제 lock_at)이 남아 아직 할 수 있다 */
export function isLateOpen(item: ScheduleItem, now: number): boolean {
  return pastDue(item, now) && item.lateUntilMs !== undefined && item.lateUntilMs > now;
}
