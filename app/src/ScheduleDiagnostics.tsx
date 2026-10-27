import { useMemo } from "react";
import type { CardData } from "./store";
import { compareSchedules } from "./scheduleEngine";
export function ScheduleDiagnostics({
  snapshot,
  demo,
  zone,
}: {
  snapshot: Map<string, CardData>;
  demo: boolean;
  zone: string;
}) {
  const rows = useMemo(
    () =>
      compareSchedules(
        [...snapshot.values()].flatMap((d) => d.indexes),
        zone,
      ),
    [snapshot, zone],
  );
  return (
    <section className="panel">
      <h2>Расписание · проверка правил</h2>
      <p className="micro">
        {demo
          ? "Демо использует явно заданные правила синтетического набора. Это не подтверждение правил CleverVet."
          : "По оригинальному счётчику CleverVet: начало dates.start приводится к началу часа; N > 0 — каждые N часов; 0 — одно 60-минутное окно. Отметки сохранены в истории."}
      </p>
      <p className="micro">
        Ниже — сравнение подтверждённого правила N часов с results.hour для всех
        неотрицательных значений в загруженных данных, включая нулевое часовое
        окно.
      </p>
      <div className="diagnostic-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Период, ч</th>
              <th>hour</th>
              <th>Совпало</th>
              <th>Разошлось</th>
              <th>Неясно</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ruleId}>
                <th>{row.periodicity}</th>
                <td>{row.observed}</td>
                <td>{row.matched}</td>
                <td>{row.contradictions}</td>
                <td>{row.unplaced}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="micro">
        Сравнение выполняется только в памяти браузера по dates.start /
        dates.periodicity и results.hour. creationDate не используется вместо
        hour. Никакие данные и отчёты не отправляются в Codex или внешние
        сервисы.
      </p>
    </section>
  );
}
