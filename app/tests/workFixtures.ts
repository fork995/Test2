import { T } from "./fixtures";
// Entirely synthetic data. Numeric 24 follows the user-confirmed UI contract.
const chain = (
  id: string,
  name: string,
  hour: number,
  minute = 0,
  extra: Record<string, unknown> = {},
  type = "MEDICATION",
) => ({
  id,
  name,
  type,
  elements: [
    {
      id: `${id}-r`,
      dates: { start: T(17, hour, minute), periodicity: 24 },
      endDate: T(20, hour, minute),
      color: "#334455",
      specifics: {
        dose: { value: 5, unit: "мг" },
        route: "в/в",
        concentration: { value: 10, unit: "мг/мл" },
        patientWeightKg: 4.2,
        weightKg: 4.2,
        viewMode: "test",
      },
      instruction: "Учебная инструкция",
      results: [] as { id: string; hour: string; status: string }[],
      ...extra,
    },
  ],
});
export const workChains = () => [
  chain("current", "Учебное текущее", 8, 15),
  chain("second", "Учебное второе", 8, 45),
  chain("next", "Учебное следующее", 9),
  chain("later", "Учебное позднее", 23, 30),
  chain("done", "Учебное выполненное", 8, 20, {
    results: [
      {
        id: "done-r",
        hour: T(18, 8),
        status: "EXECUTED",
        color: "#aabbcc",
      },
    ],
  }),
  chain("not", "Учебное с отказом", 8, 25, {
    results: [
      {
        id: "not-r",
        hour: T(18, 8),
        status: "NOT_EXECUTED",
        reason: "MEDICATION_ABSENT",
        comment: "Учебный комментарий",
        color: "#cc7788",
      },
    ],
  }),
  chain(
    "rate",
    "Учебная инфузия",
    8,
    30,
    { specifics: { scarce: { value: 15 }, maintenance: true } },
    "SOLUTION",
  ),
  chain("unknown", "Учебное неясное", 8, 0, {
    dates: { start: T(18, 8), periodicity: -1 },
  }),
  chain("ended", "Учебное завершённое", 8, 0, { endDate: T(18, 8) }),
];
