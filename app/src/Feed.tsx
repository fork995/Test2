import { memo, useMemo, useState, type CSSProperties } from "react";
import { LABELS, STATUS, REASONS, safeColor, type IndexedChain } from "./model";
import { buildFeed, type FeedItem } from "./feed";
import { clinicalFields } from "./clinical";
import { formatTime, formatDate, formatStamp } from "./time";
import { Pager } from "./ui";
import type { Period } from "./period";
import type { Selection } from "./Grid";
const FeedCard = memo(function FeedCard({
  item,
  zone,
  onSelect,
}: {
  item: FeedItem;
  zone: string;
  onSelect: (s: Selection) => void;
}) {
  const { index, revision, entry } = item,
    chain = index.chain,
    result = entry?.result;
  const fields = useMemo(
    () => clinicalFields(chain, revision),
    [chain, revision],
  );
  return (
    <button
      className="feed-card"
      style={
        {
          "--prescription-color": safeColor(revision?.color || ""),
        } as CSSProperties
      }
      onClick={() =>
        onSelect({
          index,
          revision,
          entries: entry ? [entry] : undefined,
          at: item.at ?? undefined,
          warnings: item.warnings,
        })
      }
    >
      <span className="feed-card-top">
        <span className="feed-time">
          {item.at === null
            ? item.kind === "unscheduled"
              ? "Без расписания"
              : "Время не определено"
            : `${formatTime(item.at, zone)} · ${formatDate(item.at, zone).slice(0, 6)}`}
        </span>
        <span className="feed-category">
          {LABELS[chain.type] || chain.type}
        </span>
      </span>
      <span className="feed-name">{chain.name}</span>
      {fields.length > 0 && (
        <span className="clinical-fields">
          {fields.map((field) => (
            <span key={field.path}>
              <span className="field-label">{field.label}: </span>
              <b>{field.value}</b>
            </span>
          ))}
        </span>
      )}
      {chain.type === "SOLUTION" && revision && (
        <span className="feed-interval">
          Начало: {formatStamp(revision.start, zone)}
          {revision.end !== null
            ? ` · Конец: ${formatStamp(revision.end, zone)}`
            : ""}
        </span>
      )}
      {revision?.instruction && (
        <span className="feed-instruction">{revision.instruction}</span>
      )}
      {result?.comment && (
        <span className="feed-comment">
          {chain.type === "MONITORING" ? "Значение" : "Комментарий"}:{" "}
          <b>{result.comment}</b>
        </span>
      )}
      <span className="feed-card-bottom">
        <span
          className={`status-badge ${result?.status === "EXECUTED" ? "executed" : result?.status === "NOT_EXECUTED" ? "not-executed" : "undefined-status"}`}
        >
          {result && (
            <i
              className="result-dot"
              aria-label={`Цвет результата ${result?.color || "не указан"}`}
              style={{ background: safeColor(result?.color || "") }}
            />
          )}
          {result
            ? STATUS[result.status] || result.status || "Статус не указан"
            : "Статус не определён"}
        </span>
        <span className="feed-history">Детали · История</span>
      </span>
      {result?.reason && (
        <span className="feed-reason">
          {REASONS[result.reason] || result.reason}
        </span>
      )}
      {item.kind === "unscheduled" && item.confidence === "uncertain" && (
        <span className="feed-warning">Активность не подтверждена</span>
      )}
      {item.kind !== "unscheduled" && item.warnings.length > 0 && (
        <span className="feed-warning">
          Есть неоднозначность · подробнее в деталях
        </span>
      )}
    </button>
  );
});
function Cards({
  items,
  zone,
  onSelect,
  size = 20,
}: {
  items: FeedItem[];
  zone: string;
  onSelect: (s: Selection) => void;
  size?: number;
}) {
  const [page, setPage] = useState(0);
  const safePage = Math.min(
    page,
    Math.max(0, Math.ceil(items.length / size) - 1),
  );
  return (
    <>
      <div className="feed-cards">
        {items.slice(safePage * size, (safePage + 1) * size).map((item) => (
          <FeedCard
            key={item.key}
            item={item}
            zone={zone}
            onSelect={onSelect}
          />
        ))}
      </div>
      <Pager
        label="Страницы назначений"
        page={safePage}
        count={items.length}
        size={size}
        onChange={setPage}
      />
    </>
  );
}
export const Feed = memo(function Feed({
  indexes,
  period,
  zone,
  category,
  onSelect,
}: {
  indexes: IndexedChain[];
  period: Period | null;
  zone: string;
  category: string;
  onSelect: (s: Selection) => void;
}) {
  const data = useMemo(
    () => buildFeed(indexes, period, category),
    [indexes, period, category],
  );
  const [unplacedOpen, setUnplacedOpen] = useState(false),
    [unscheduledOpen, setUnscheduledOpen] = useState(true);
  return (
    <div className="feed">
      {!period && (
        <p className="notice">
          Выберите корректный интервал в настройках. Время открытия приложения
          не используется как начало смены.
        </p>
      )}
      {data.events.length > 0 ? (
        <Cards
          key={`events:${period?.key}:${category}`}
          items={data.events}
          zone={zone}
          onSelect={onSelect}
        />
      ) : (
        <p className="feed-empty">
          Нет зарегистрированных результатов за выбранную смену.
        </p>
      )}
      {data.unscheduled.length > 0 && (
        <section className="unscheduled-section">
          <button
            className="section-toggle"
            aria-expanded={unscheduledOpen}
            onClick={() => setUnscheduledOpen((v) => !v)}
          >
            <span>Действующие назначения без подтверждённого расписания</span>
            <span>
              {data.unscheduled.length} {unscheduledOpen ? "⌃" : "⌄"}
            </span>
          </button>
          {unscheduledOpen && (
            <>
              <p className="micro">
                Без статуса выполнения. Если активность редакции не
                подтверждена, это отмечено в карточке.
              </p>
              <Cards
                key={`unscheduled:${period?.key}:${category}`}
                items={data.unscheduled}
                zone={zone}
                onSelect={onSelect}
                size={10}
              />
            </>
          )}
        </section>
      )}
      {data.unplaced.length > 0 && (
        <section>
          <button
            className="section-toggle"
            aria-expanded={unplacedOpen}
            onClick={() => setUnplacedOpen((v) => !v)}
          >
            <span>Результаты с неоднозначным временем</span>
            <span>
              {data.unplaced.length} {unplacedOpen ? "⌃" : "⌄"}
            </span>
          </button>
          {unplacedOpen && (
            <>
              <p className="micro">
                Не отфильтрованы по смене: hour не задаёт однозначную дату.
                creationDate показана отдельно в деталях.
              </p>
              <Cards
                items={data.unplaced}
                zone={zone}
                onSelect={onSelect}
                size={10}
              />
            </>
          )}
        </section>
      )}
      {data.warnings.length > 0 && (
        <p className="feed-warning">
          Есть противоречия в редакциях. Подробности — в истории и настройках (
          {data.warnings.length}).
        </p>
      )}
    </div>
  );
});
