import type { Branch } from "./model";
import type { DepartmentChoice } from "./preferences";
const normalized = (name: string) =>
  name.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
const BRANCH = "ИВЦ Запад",
  DEPARTMENT = "Хирургический стационар";
export interface InitialDepartment {
  branchId: string;
  departmentId: string;
  notice: string;
}
// IDs always come from the authorized /branches response, never from a guessed UUID or array position.
export function initialDepartment(
  branches: Branch[],
  saved: DepartmentChoice | null,
  demo = false,
): InitialDepartment {
  if (saved) {
    const branch = branches.find((b) => b.id === saved.branchId);
    if (branch?.departments.some((d) => d.id === saved.departmentId))
      return { ...saved, notice: "" };
    return {
      branchId: branch?.id ?? "",
      departmentId: "",
      notice:
        "Сохранённое отделение недоступно этой учётной записи. Выберите другое отделение.",
    };
  }
  // The demonstration uses its own invented departments and never overwrites the real selection.
  if (demo)
    return {
      branchId: branches[0]?.id ?? "",
      departmentId: branches[0]?.departments[0]?.id ?? "",
      notice: "",
    };
  const pairs = branches
    .filter((b) => normalized(b.name) === normalized(BRANCH))
    .flatMap((b) =>
      b.departments
        .filter((d) => normalized(d.name) === normalized(DEPARTMENT))
        .map((d) => ({ branchId: b.id, departmentId: d.id })),
    );
  if (pairs.length === 1) return { ...pairs[0], notice: "" };
  const named = branches.filter(
    (b) => normalized(b.name) === normalized(BRANCH),
  );
  return {
    branchId: named.length === 1 ? named[0].id : "",
    departmentId: "",
    notice:
      pairs.length > 1
        ? "Найдено несколько отделений «ИВЦ Запад — хирургический стационар». Выберите нужное отделение."
        : "Отделение «ИВЦ Запад — хирургический стационар» недоступно этой учётной записи. Выберите другое отделение.",
  };
}
