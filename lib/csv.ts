// CSV in and out for the captain's import/export (slice 5). Check: node scripts/check-csv.mjs

// RFC 4180: quoted cells may hold the delimiter, quotes ("") and newlines. Blank lines are dropped.
// Excel with Finnish settings saves with ';', so the delimiter is whichever the header line has more of.
export function parseCsv(text: string): string[][] {
  const head = text.split("\n", 1)[0];
  const delim = head.split(";").length > head.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
}

// Text a spreadsheet would run as a formula gets a leading ' (SDD §5). Numbers stay numbers.
const cell = (v: string | number) => {
  if (typeof v === "number") return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: (string | number)[][]) => rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

// What one import column means. A category column holds that category's opening balance.
export type Target = "email" | "name" | "skip" | `category:${string}`;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
const ALIASES: Record<string, Target> = {
  email: "email", emailaddress: "email", sahkoposti: "email", mail: "email",
  name: "name", nimi: "name", fullname: "name", displayname: "name",
  group: "skip", tutorgroup: "skip", ryhma: "skip", tutorryhma: "skip", // no tutor groups (SDD §11)
};

// Header → target by name only; null when unsure (then the AI suggests and the captain decides).
export function guessTarget(header: string, categories: string[]): Target | null {
  const h = norm(header);
  if (ALIASES[h]) return ALIASES[h];
  const cat = categories.find((c) => norm(c) === h);
  return cat ? `category:${cat}` : null;
}
