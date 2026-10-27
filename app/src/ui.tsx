export function Loader({ text = "Загрузка…" }: { text?: string }) {
  return (
    <p className="loading" role="status">
      <span className="spinner" />
      {text}
    </p>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}
export function Pager({
  page,
  count,
  size,
  onChange,
  label,
}: {
  page: number;
  count: number;
  size: number;
  onChange: (n: number) => void;
  label: string;
}) {
  const pages = Math.ceil(count / size);
  if (pages <= 1) return null;
  return (
    <div className="pager" aria-label={label}>
      <button
        className="secondary small"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        Назад
      </button>
      <span>
        {page + 1} / {pages} · всего {count}
      </span>
      <button
        className="secondary small"
        disabled={page >= pages - 1}
        onClick={() => onChange(page + 1)}
      >
        Далее
      </button>
    </div>
  );
}
