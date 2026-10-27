import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
function Measured({
  id,
  onSize,
  top,
  children,
}: {
  id: string;
  onSize: (id: string, height: number) => void;
  top: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const height = el.getBoundingClientRect().height;
      if (height > 0) onSize(id, height);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [id, onSize]);
  return (
    <div
      ref={ref}
      className="windowed-row"
      style={{ position: "absolute", top, left: 0, right: 0, paddingBottom: 5 }}
    >
      {children}
    </div>
  );
}
export function WindowedList<T>({
  items,
  id,
  render,
}: {
  items: T[];
  id: (item: T) => string;
  render: (item: T) => ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null),
    heights = useRef(new Map<string, number>()),
    [revision, setRevision] = useState(0),
    [viewport, setViewport] = useState({ top: 0, height: 500 });
  const measure = useRef((key: string, height: number) => {
    if (Math.abs((heights.current.get(key) ?? 118) - height) > 1) {
      heights.current.set(key, height);
      setRevision((n) => n + 1);
    }
  }).current;
  const offsets = useMemo(() => {
    let total = 0;
    const values = items.map((item) => {
      const offset = total;
      total += heights.current.get(id(item)) ?? 118;
      return offset;
    });
    return { values, total };
  }, [items, id, revision]);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const update = () =>
      setViewport((v) => ({ ...v, height: el.clientHeight || 500 }));
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [items.length > 50]);
  if (items.length <= 50)
    return (
      <div className="work-items">
        {items.map((item) => (
          <div key={id(item)}>{render(item)}</div>
        ))}
      </div>
    );
  let first = 0;
  while (
    first < items.length &&
    offsets.values[first] + (heights.current.get(id(items[first])) ?? 118) <
      viewport.top
  )
    first++;
  first = Math.max(0, first - 3);
  let last = first;
  while (
    last < items.length &&
    offsets.values[last] < viewport.top + viewport.height + 400
  )
    last++;
  last = Math.min(items.length, Math.max(last, first + 6));
  return (
    <div
      className="windowed-list"
      ref={container}
      tabIndex={0}
      aria-label="Прокручиваемый список назначений"
      onScroll={(e) =>
        setViewport({
          top: e.currentTarget.scrollTop,
          height: e.currentTarget.clientHeight || 500,
        })
      }
    >
      <div style={{ height: offsets.total, position: "relative" }}>
        {items.slice(first, last).map((item, i) => (
          <Measured
            key={id(item)}
            id={id(item)}
            onSize={measure}
            top={offsets.values[first + i]}
          >
            {render(item)}
          </Measured>
        ))}
      </div>
    </div>
  );
}
