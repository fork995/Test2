import type { Branch } from "./model";
import { newResultId } from "./resultWriter";
import { SEVERITIES } from "./patientPresentation";
import { addDay, dayKey, formatTime, zonedStart } from "./time";
export const GENDERS = { MALE: "Самец", FEMALE: "Самка" } as const;
export const HOSPITALS = {
  DAY: "Дневной стационар",
  ROUND_THE_CLOCK: "Круглосуточный стационар",
} as const;
export interface PatientDraft {
  name: string;
  species: string;
  breed: string;
  gender: string;
  castrated: string;
  years: string;
  months: string;
  days: string;
  weight: string;
  severity: string;
  cage: string;
  surname: string;
  firstName: string;
  patronymic: string;
  email: string;
  diagnoses: string;
  allergies: string;
  hospital: string;
  date: string;
  clock: string;
}
export const emptyPatientDraft = (now: number, zone: string): PatientDraft => ({
  name: "",
  species: "",
  breed: "",
  gender: "",
  castrated: "",
  years: "",
  months: "",
  days: "",
  weight: "",
  severity: "",
  cage: "",
  surname: "",
  firstName: "",
  patronymic: "",
  email: "",
  diagnoses: "",
  allergies: "",
  hospital: "",
  date: dayKey(now, zone),
  clock: formatTime(now, zone),
});
/** Original Ny.branchFromDto = Ry(workShiftStart,24), sA.start/end, EA.firstTreatmentSheet. */
export function firstSheet(start: number, branch: Branch, zone: string) {
  const raw = branch.workShiftStart;
  const match = /^(\d{1,2})(?::00(?::00)?)?$/.exec(raw);
  if (!match || +match[1] > 23)
    throw Error(
      "Время смены филиала не подтверждено. Создание недоступно до уточнения workShiftStart.",
    );
  const clock = `${match[1].padStart(2, "0")}:00`;
  let date = dayKey(start, zone),
    first = zonedStart(date, clock, zone);
  if (first === null)
    throw Error("Граница смены неоднозначна в выбранном часовом поясе.");
  if (start < first) {
    date = addDay(date, -1);
    first = zonedStart(date, clock, zone);
  }
  const end = zonedStart(addDay(date, 1), clock, zone);
  if (first === null || end === null || end <= first)
    throw Error("Не удалось определить границы первого листа.");
  return {
    start: new Date(first).toISOString(),
    end: new Date(end).toISOString(),
  };
}
const lines = (s: string) =>
  s
    .split(/\n/)
    .map((v) => v.trim())
    .filter(Boolean);
function ageValue(raw: string, max: number) {
  if (!raw.trim())
    throw Error("Укажите возраст: годы, месяцы и дни, включая явные нули.");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > max)
    throw Error("Возраст должен содержать целые неотрицательные значения.");
  return n;
}
export function buildPatient(
  d: PatientDraft,
  branch: Branch,
  zone: string,
  now = Date.now(),
) {
  if (
    !d.name.trim() ||
    !d.species.trim() ||
    !d.breed.trim() ||
    !d.surname.trim() ||
    !d.firstName.trim() ||
    !lines(d.diagnoses).length ||
    !Object.hasOwn(GENDERS, d.gender) ||
    !Object.hasOwn(SEVERITIES, d.severity) ||
    !Object.hasOwn(HOSPITALS, d.hospital) ||
    !["yes", "no"].includes(d.castrated)
  )
    throw Error(
      "Заполните кличку, вид, породу, ФИО владельца, диагноз, пол, тяжесть, стационар и состояние кастрации.",
    );
  const weight = d.weight.trim() ? Number(d.weight.replace(",", ".")) : null;
  if (
    weight === null ||
    !Number.isFinite(weight) ||
    weight < 0.01 ||
    weight > 999.99
  )
    throw Error("Укажите массу от 0,01 до 999,99 кг.");
  if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim()))
    throw Error("Проверьте email владельца.");
  const start = zonedStart(d.date, d.clock, zone);
  if (start === null || start > now)
    throw Error(
      "Укажите корректное начало лечения, не позже текущего времени.",
    );
  const sheet = firstSheet(start, branch, zone),
    stamp = new Date(now).toISOString();
  const years = ageValue(d.years, 99),
    months = ageValue(d.months, 11),
    days = ageValue(d.days, 30);
  return {
    id: newResultId(now),
    name: d.name.trim(),
    gender: d.gender as keyof typeof GENDERS,
    severity: d.severity as keyof typeof SEVERITIES,
    weightKg: weight,
    age: { years, months, days },
    species: d.species.trim(),
    breed: d.breed.trim(),
    card: {
      id: newResultId(now),
      status: "ACTIVE" as const,
      hospital: d.hospital as keyof typeof HOSPITALS,
      number: null,
      diagnoses: lines(d.diagnoses),
      allergies: d.allergies.trim() || null,
      treatment: {
        start: new Date(start).toISOString(),
        sheets: [
          {
            id: newResultId(now),
            ...sheet,
            locked: false,
            creationDate: stamp,
          },
        ],
      },
      creationDate: stamp,
    },
    castrated: d.castrated === "yes",
    cageNumber: d.cage.trim() || null,
    owner: {
      name: d.firstName.trim() || null,
      surname: d.surname.trim() || null,
      patronymic: d.patronymic.trim() || null,
      email: d.email.trim() || null,
    },
    creationDate: stamp,
  };
}
export type NewPatient = ReturnType<typeof buildPatient>;
