import {
  CATEGORIES,
  normalizeBranches,
  normalizePatients,
  normalizeChains,
} from "./model";
import { HOUR, currentShiftKey, zonedStart, deviceZone } from "./time";
export function mockData(big = false, now = Date.now()) {
  const zone = deviceZone();
  const start = zonedStart(currentShiftKey(now, "08:00", zone), "08:00", zone)!;
  const currentOffset = Math.floor((now - start) / HOUR);
  const markedHours = Array.from({ length: 48 }, (_, i) => i).filter(
    (i) => i !== currentOffset && i !== currentOffset + 1,
  );
  const iso = (offset: number) => new Date(start + offset * HOUR).toISOString();
  const branches = normalizeBranches([
    {
      id: "demo-branch",
      name: "Демо-клиника",
      workShiftStart: "08:00",
      departments: [
        { id: "demo-department", name: "Стационар" },
        { id: "demo-empty", name: "Пустое отделение" },
      ],
    },
  ]);
  const patients = normalizePatients([
    {
      id: "patient-1",
      name: "Демо · Барс",
      owner: { surname: "Учебный", name: "Владелец" },
      photo: "demo-illustration",
      species: "Кошка",
      breed: "Метис",
      gender: "MALE",
      weightKg: 4.2,
      severity: "MODERATE",
      cageNumber: "А-03",
      card: {
        id: "medical-card-101",
        status: "ACTIVE",
        diagnoses: [{ name: "Учебный пример: восстановление" }],
        hospital: "Стационар",
        treatment: {
          start: iso(-24),
          sheets: [
            { id: "sheet-1", start: iso(0), end: iso(24) },
            { id: "sheet-2", start: iso(-24), end: iso(0) },
          ],
        },
      },
    },
    {
      id: "patient-2",
      name: "Демо · Рэй",
      species: "Собака",
      breed: "Метис",
      weightKg: 12,
      severity: "SATISFACTORY",
      card: {
        id: "medical-card-102",
        status: "ACTIVE",
        treatment: {
          start: iso(0),
          sheets: [{ id: "ray-sheet", start: iso(0), end: iso(24) }],
        },
      },
    },
  ]);
  const names = [
    "Температура тела",
    "Прогулка",
    "Инфузия · учебный раствор",
    "Препарат · учебный пример",
    "Осмотр катетера",
    "Гигиенический уход",
  ];
  const chains = normalizeChains(
    Array.from({ length: big ? 360 : 18 }, (_, i) => ({
      id: `chain-${i}`,
      name: `${names[i % 6]}${i >= 6 ? ` · ${Math.floor(i / 6) + 1}` : ""}`,
      type: CATEGORIES[i % 6],
      elements: [
        {
          id: `old-${i}`,
          color: "#75b6dc",
          dates: { start: iso(-24), periodicity: 1 },
          endDate: iso(0),
          instruction: "Учебные данные. Не использовать для лечения.",
          specifics: { periodicity: 24 },
          results: [
            {
              id: `prev-${i}`,
              status: "EXECUTED",
              hour: iso(-20),
              creationDate: iso(-19.8),
              color: "#6495ed",
            },
          ],
        },
        {
          id: `new-${i}`,
          parentId: `old-${i}`,
          color: [
            "#d1b47e",
            "#a2c17c",
            "#65bdb1",
            "#9f9bd3",
            "#d18d9c",
            "#8db1bc",
          ][i % 6],
          dates: { start: iso(0), periodicity: i % 6 === 2 ? 0 : 1 },
          endDate: iso(48),
          specifics:
            i % 6 === 2
              ? { scarce: { value: 15 }, maintenance: true, periodicity: 0 }
              : i % 6 === 3
                ? {
                    medication: "Учебный препарат",
                    dose: { value: 5, unit: "мг" },
                    route: "в/в",
                    concentration: { value: 10, unit: "мг/мл" },
                    patientWeightKg: 4.2,
                    periodicity: 1,
                  }
                : { periodicity: 1 },
          instruction: "Демонстрационное назначение. Все сведения обезличены.",
          results: Array.from(
            { length: big ? 36 : i === 17 ? 0 : 4 },
            (_, j) => ({
              id: `result-${i}-${j}`,
              status: j % 4 === 1 ? "NOT_EXECUTED" : "EXECUTED",
              reason: j % 4 === 1 ? "MEDICATION_ABSENT" : "",
              hour: iso(markedHours[j]),
              creationDate: iso(markedHours[j] + 0.1),
              color: j % 4 === 1 ? "#cc7e86" : "#80b9a8",
              comment:
                i % 6 === 0
                  ? "38.7 — учебный пример"
                  : j % 4 === 1
                    ? "Демонстрация причины невыполнения"
                    : "",
            }),
          ),
        },
      ],
    })),
  );
  return { branches, patients, chains, start };
}
