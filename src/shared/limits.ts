// Validation shared by the teacher UI and the API. Each check returns an
// error message in plain Chinese, or null when the value is fine.

export const MAX_CLASS_NAME = 40;
export const MAX_STUDENT_NAME = 30;
export const MAX_SEAT = 999;
export const MAX_GROUPING_NAME = 40;
export const MAX_GROUP_NAME = 20;
export const MAX_GROUPS = 50;
export const MAX_IMPORT_ROWS = 200;

function text(label: string, max: number) {
  return (value: unknown): string | null => {
    if (typeof value !== "string" || value.trim() === "") return `請填寫${label}。`;
    if (value.trim().length > max) return `${label}最多 ${max} 個字。`;
    return null;
  };
}

export const checkClassName = text("班級名稱", MAX_CLASS_NAME);
export const checkStudentName = text("姓名", MAX_STUDENT_NAME);
export const checkGroupingName = text("分組名稱", MAX_GROUPING_NAME);
export const checkGroupName = text("組名", MAX_GROUP_NAME);

export function checkSeat(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return "座號要是正整數。";
  if (value > MAX_SEAT) return `座號不能超過 ${MAX_SEAT}。`;
  return null;
}

export function checkGroupCount(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return "組數要是正整數。";
  if (value > MAX_GROUPS) return `最多分成 ${MAX_GROUPS} 組。`;
  return null;
}
