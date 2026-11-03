import { checkSeat, checkStudentName } from "./limits";

export type RosterRow = {
  line: number; // 1-based line number in the pasted text
  seat: number | null;
  name: string;
  error: string | null;
};

// Parse a roster pasted from Excel (or typed by hand): one student per line,
// seat number then name, separated by tab, comma or spaces.
export function parseRoster(input: string): RosterRow[] {
  const rows: RosterRow[] = [];
  const lines = input.split(/\r?\n/);
  lines.forEach((raw, i) => {
    // NFKC turns full-width digits, commas and spaces into their ASCII forms.
    const line = raw.normalize("NFKC").trim();
    if (!line) return;

    let fields: string[];
    if (line.includes("\t")) fields = line.split("\t");
    else if (line.includes(",")) fields = line.split(",");
    else fields = line.split(/\s+/);
    fields = fields.map((f) => f.trim());

    const [seatText = "", ...rest] = fields;
    // Skip a header row copied together with the data.
    if (rows.length === 0 && /座號/.test(seatText)) return;

    const name = rest.filter(Boolean).join(" ");
    const seat = /^\d+$/.test(seatText) ? Number(seatText) : null;
    let error: string | null;
    if (seat === null) error = "座號不是數字。";
    else if (!name) error = "缺少姓名。";
    else error = checkSeat(seat) ?? checkStudentName(name);
    rows.push({ line: i + 1, seat, name, error });
  });

  // Mark later duplicates so the first occurrence can still be imported.
  const seen = new Map<number, number>();
  for (const row of rows) {
    if (row.error || row.seat === null) continue;
    const first = seen.get(row.seat);
    if (first !== undefined) row.error = `座號重複（和第 ${first} 行相同）。`;
    else seen.set(row.seat, row.line);
  }
  return rows;
}
