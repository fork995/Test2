export const T = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 9, day, hour, minute)).toISOString();
export const branches = [
  {
    id: "b",
    name: "ИВЦ Запад",
    workShiftStart: "08:42",
    departments: [
      { id: "d", name: "Хирургический стационар" },
      { id: "empty", name: "Пустое отделение" },
    ],
  },
];
export function rawPatients(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Демо пациент ${i + 1}`,
    species: "Кошка",
    weightKg: 4.2,
    severity: "Стабильная",
    cageNumber: i + 1,
    card: {
      id: `c${i + 1}`,
      status: "ACTIVE",
      diagnoses: [{ name: "Учебный диагноз" }],
      treatment: {
        sheets: [
          { id: `s${i}-prev`, start: T(17, 8), end: T(18, 8) },
          { id: `s${i}-current`, start: T(18, 8), end: T(19, 8) },
          { id: `s${i}-next`, start: T(19, 8), end: T(20, 8) },
        ],
      },
    },
  }));
}
export const rawChains = [
  {
    id: "med",
    name: "Учебный препарат",
    type: "MEDICATION",
    elements: [
      {
        id: "med-old",
        dates: { start: T(17, 8) },
        color: "#112233",
        specifics: { dose: { value: 1, unit: "мг" } },
        results: [{ id: "previous", hour: T(17, 10), status: "EXECUTED" }],
      },
      {
        id: "med-new",
        parentId: "med-old",
        dates: { start: T(18, 8) },
        endDate: T(20, 8),
        color: "#334455",
        creationDate: T(18, 7),
        specifics: {
          medication: { name: "Учебный препарат" },
          dose: { value: 5, unit: "мг" },
          route: "в/в",
          concentration: { value: 10, unit: "мг/мл" },
          patientWeightKg: 4.2,
          periodicity: 24,
        },
        instruction: "Медицинская инструкция — учебный пример",
        results: [
          {
            id: "m1",
            hour: T(18, 10),
            creationDate: T(18, 10, 43),
            status: "EXECUTED",
            color: "#aabbcc",
          },
          {
            id: "m2",
            hour: T(19, 8),
            creationDate: T(19, 8, 5),
            status: "EXECUTED",
          },
        ],
      },
    ],
  },
  {
    id: "solution",
    name: "Учебный раствор",
    type: "SOLUTION",
    elements: [
      {
        id: "solution-r",
        dates: { start: T(18, 8) },
        endDate: T(19, 8),
        color: "#65bdb1",
        specifics: { scarce: { value: 15 }, maintenance: true },
        instruction: "Учебная инструкция раствора",
        results: [
          {
            id: "s1",
            hour: T(18, 9),
            creationDate: T(18, 9, 1),
            status: "NOT_EXECUTED",
            reason: "MEDICATION_ABSENT",
            color: "#cc7788",
            comment: "Только учебный комментарий",
          },
        ],
      },
    ],
  },
  {
    id: "monitor",
    name: "Температура · учебная",
    type: "MONITORING",
    elements: [
      {
        id: "monitor-r",
        dates: { start: T(18, 8) },
        endDate: T(20, 8),
        results: [
          {
            id: "v1",
            hour: T(18, 11),
            creationDate: T(18, 12),
            status: "EXECUTED",
            comment: "38.7",
          },
          {
            id: "uncertain",
            hour: "12:00",
            creationDate: T(18, 12),
            status: "EXECUTED",
            comment: "Неоднозначное время",
          },
        ],
      },
    ],
  },
  {
    id: "activity",
    name: "Учебная активность без результатов",
    type: "ACTIVITY",
    elements: [
      {
        id: "act-r",
        dates: { start: T(18, 8) },
        specifics: { periodicity: 1 },
        instruction: "Без вычисленного расписания",
        results: [],
      },
    ],
  },
  {
    id: "midnight",
    name: "Учебная процедура",
    type: "PROCEDURE",
    elements: [
      {
        id: "mid-r",
        dates: { start: T(18, 8) },
        endDate: T(20, 8),
        results: [
          {
            id: "mid1",
            hour: T(18, 23, 59),
            creationDate: T(19, 0, 10),
            status: "EXECUTED",
          },
          {
            id: "mid2",
            hour: T(19, 0),
            creationDate: T(19, 1),
            status: "NOT_EXECUTED",
            reason: "BODY_CONDITION_CHANGED",
          },
        ],
      },
    ],
  },
];
