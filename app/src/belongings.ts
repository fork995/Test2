import { obj, text, instant } from "./model";
import { zonedStart } from "./time";
export const BELONGING_STATUSES = {
  RECEIVED: "Принято",
  RETURNED: "Возвращено",
  CONSUMED: "Израсходовано",
} as const;
export type BelongingStatus = keyof typeof BELONGING_STATUSES;
export interface Belonging {
  id: string;
  name: string;
  receivingDate: string;
  status: string;
  comment: string;
  creationDate: string;
  returnDate?: string;
}
export const calendarDate = (value: string) =>
  /^\d{4}-\d\d-\d\d$/.test(value) && zonedStart(value, "12:00", "UTC") !== null;
export function normalizeBelongings(value: unknown[]): Belonging[] {
  const rows = value.map(obj).map((v) => ({
    id: text(v.id),
    name: text(v.name),
    receivingDate: text(v.receivingDate),
    status: text(v.status),
    comment: text(v.comment),
    creationDate: text(v.creationDate),
    ...(typeof v.returnDate === "string" && v.returnDate
      ? { returnDate: v.returnDate }
      : {}),
  }));
  if (
    rows.some(
      (b) =>
        !b.id ||
        !b.name ||
        !calendarDate(b.receivingDate) ||
        instant(b.creationDate) === null ||
        (b.returnDate && !calendarDate(b.returnDate)),
    ) ||
    new Set(rows.map((b) => b.id)).size !== rows.length
  )
    throw Error(
      "Не удалось прочитать список вещей: неожиданный формат данных.",
    );
  return rows;
}
export function validateBelonging(b: Belonging) {
  if (
    !b.name.trim() ||
    !calendarDate(b.receivingDate) ||
    instant(b.creationDate) === null ||
    !Object.hasOwn(BELONGING_STATUSES, b.status)
  )
    throw Error("Проверьте название, дату и статус вещи.");
}
