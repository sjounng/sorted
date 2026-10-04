import type { ScheduleItem } from "./api";
import { daysLeft } from "./format";

/** 마감이 지나도 이 날수까지는 "Overdue"로 보여 준다. 더 오래된 건 쌓이지 않게 목록에서 뺀다 (달력에선 보임) */
export const OVERDUE_DAYS = 7;

/** 마감이 지났는데 아직 안 했고, 지난 지 OVERDUE_DAYS일 이내 */
export function isOverdue(item: ScheduleItem, now: number): boolean {
  return !item.done && item.dueAtMs < now && daysLeft(item.dueAtMs, now) >= -OVERDUE_DAYS;
}

/** 마감은 지났지만 지각 인정 기간이 남아 아직 할 수 있는지 (영상 late_at) */
export function lateStillOpen(item: ScheduleItem, now: number): boolean {
  return item.lateUntilMs !== undefined && item.lateUntilMs > now;
}
