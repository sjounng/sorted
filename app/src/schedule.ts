import type { ScheduleItem } from "./api";
import { daysLeft } from "./format";

// 마감이 지났는데 안 한 일정은 둘로 나눈다.
// - 지각 인정 중(late · still open): 아직 하면 인정된다. 가장 급하므로 Dashboard에도 띠로 알린다.
// - 놓침(missed): 지각 인정이 없거나 끝났다. 할 수 있는 게 없으니 Schedule에만 기록으로 남긴다.

/** 놓친 것은 지난 지 이 날수까지만 Schedule 목록에 남긴다 (더 오래된 건 달력에서만) */
export const MISSED_DAYS = 7;

function pastDue(item: ScheduleItem, now: number): boolean {
  return !item.done && item.kind !== "event" && item.dueAtMs < now;
}

/** 마감은 지났지만 지각 인정 기한(영상 late_at, 과제 lock_at)이 남아 아직 할 수 있다 */
export function isLateOpen(item: ScheduleItem, now: number): boolean {
  return pastDue(item, now) && item.lateUntilMs !== undefined && item.lateUntilMs > now;
}

/** 마감이 지났고 지각 인정도 없다(또는 끝났다). 지난 지 MISSED_DAYS일 이내만 */
export function isMissed(item: ScheduleItem, now: number): boolean {
  return (
    pastDue(item, now) && !isLateOpen(item, now) && daysLeft(item.dueAtMs, now) >= -MISSED_DAYS
  );
}
