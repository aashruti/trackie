import * as XLSX from "xlsx";

/**
 * Parser for the ZKTeco / eSSL "Basic Work Duration Report" (.xls) — the format
 * Datagami's fingerprint device exports. See the design doc §5.3.
 *
 * Layout (single sheet, already daily):
 *  - Row 0: month anchors as Excel date serials (col 0 = left segment month,
 *    col 8 = right segment month). E.g. 2026-05-01 and 2026-06-01 → cycle 26 May–25 Jun.
 *  - Row 1: day headers "26 T" … "25 Th"; ONE blank spacer column splits the two
 *    month segments.
 *  - Per employee: a 6-row block — "Emp. Code:"/"Emp. Name:" header, then Status,
 *    InTime, OutTime, Total — separated by a blank row.
 *  - Status ∈ {P, A, WO, ½P, WO½P}; In/Out = "HH:MM" or a text annotation
 *    (WFH / Leave / Official Visit / Holiday / No Punch-in / HD); Total = "H:MM".
 *
 * Output is one NormalizedDay per (employee, date) that has a status.
 */
export type NormalizedDay = {
  code: string; // device enrollment number, e.g. "8"
  name: string;
  date: string; // YYYY-MM-DD
  status: string; // raw device status token (P/A/WO/½P/WO½P)
  inTime: string | null; // "HH:MM" or null
  outTime: string | null;
  totalMinutes: number;
  annotation: string | null; // WFH / Leave / Official Visit / Holiday / No Punch-in / HD
};

export type ParsedReport = {
  periodStart: string | null;
  periodEnd: string | null;
  days: NormalizedDay[];
};

function cell(rows: unknown[][], r: number, c: number): unknown {
  return rows[r]?.[c];
}
function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Excel serial → { y, m, d } (timezone-independent). */
function serialToYMD(serial: number): { y: number; m: number; d: number } | null {
  const d = XLSX.SSF?.parse_date_code(serial);
  return d ? { y: d.y, m: d.m, d: d.d } : null;
}

/** "9:27" / "09:27" / a fractional day serial → "HH:MM", or null for text/empty. */
function toHHMM(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    // fractional day → minutes
    const mins = Math.round(v * 24 * 60);
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const s = String(v).trim();
  const mt = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!mt) return null; // it's a text annotation, not a time
  return `${mt[1].padStart(2, "0")}:${mt[2]}`;
}

/** "8:54" / "12:54" (H:MM) worked duration → minutes. */
function durationToMinutes(v: unknown): number {
  const s = str(v);
  const mt = /^(\d{1,3}):(\d{2})$/.exec(s);
  if (!mt) return 0;
  return Number(mt[1]) * 60 + Number(mt[2]);
}

// Canonical annotation phrases, matched precisely so unrelated cell text (e.g.
// a word merely starting with "No"/"Id") isn't mistaken for an annotation.
const ANNOTATION_PATTERNS: [RegExp, string][] = [
  [/wfh/i, "WFH"],
  [/official\s*visit/i, "Official Visit"],
  [/holiday/i, "Holiday"],
  [/\bleave\b/i, "Leave"],
  [/no\s*punch/i, "No Punch-in"],
  [/half[-\s]*day|\bHD\b/i, "HD"],
  [/\bcomp/i, "Comp-off"],
];
function annotationFrom(inRaw: unknown, outRaw: unknown): string | null {
  const joined = [str(inRaw), str(outRaw)]
    .filter((p) => p && !/^\d{1,2}:\d{2}/.test(p))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!joined) return null;
  for (const [re, label] of ANNOTATION_PATTERNS) if (re.test(joined)) return label;
  return null;
}

export function parseBasicWorkDurationReport(buffer: Buffer | ArrayBuffer): ParsedReport {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }) as unknown[][];

  // --- Row 0: the two month anchors (serials) with their column positions. ---
  const anchors: { col: number; y: number; m: number }[] = [];
  for (let c = 0; c < (rows[0]?.length ?? 0); c++) {
    const v = cell(rows, 0, c);
    if (typeof v === "number" && v > 20000) {
      const ymd = serialToYMD(v);
      if (ymd) anchors.push({ col: c, y: ymd.y, m: ymd.m });
    }
  }
  anchors.sort((a, b) => a.col - b.col);

  // --- Row 1: day-of-month per column ("26 T" → 26). ---
  const dayByCol = new Map<number, number>();
  for (let c = 1; c < (rows[1]?.length ?? 0); c++) {
    const h = str(cell(rows, 1, c));
    const mt = /^(\d{1,2})\b/.exec(h);
    if (mt) dayByCol.set(c, Number(mt[1]));
  }

  // Column → ISO date. The report segments run e.g. 26..31 then 1..25 across two
  // months; assign each column to a month anchor by walking the day numbers in
  // column order and advancing to the next anchor whenever the day RESETS
  // (current < previous) — robust to where the device places the anchor cells.
  const dateCols = [...dayByCol.keys()].sort((a, b) => a - b);
  const dateByCol = new Map<number, string>();
  {
    let seg = 0;
    let prevDay = 0;
    for (const c of dateCols) {
      const day = dayByCol.get(c)!;
      if (day < prevDay) seg = Math.min(seg + 1, Math.max(anchors.length - 1, 0));
      prevDay = day;
      const anchor = anchors[seg] ?? anchors[anchors.length - 1];
      if (anchor) dateByCol.set(c, `${anchor.y}-${String(anchor.m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    }
  }
  const colToDate = (col: number): string | null => dateByCol.get(col) ?? null;

  // --- Employee blocks: find each "Emp. Code:" row. ---
  const days: NormalizedDay[] = [];
  for (let r = 0; r < rows.length; r++) {
    if (!str(cell(rows, r, 0)).startsWith("Emp. Code")) continue;
    const code = str(cell(rows, r, 2));
    // Name: the value after the "Emp. Name:" label cell.
    let name = "";
    const nameLabelCol = (rows[r] ?? []).findIndex((v) => str(v).startsWith("Emp. Name"));
    if (nameLabelCol >= 0) {
      for (let c = nameLabelCol + 1; c < (rows[r]?.length ?? 0); c++) {
        if (str(cell(rows, r, c))) { name = str(cell(rows, r, c)); break; }
      }
    }
    // The Status / InTime / OutTime / Total rows follow (find by row label).
    let statusRow = -1, inRow = -1, outRow = -1, totalRow = -1;
    for (let rr = r + 1; rr < Math.min(r + 8, rows.length); rr++) {
      const label = str(cell(rows, rr, 0));
      if (label === "Status") statusRow = rr;
      else if (label === "InTime") inRow = rr;
      else if (label === "OutTime") outRow = rr;
      else if (label === "Total") totalRow = rr;
      else if (label.startsWith("Emp. Code")) break;
    }
    if (statusRow < 0) continue;

    for (const c of dateCols) {
      const status = str(cell(rows, statusRow, c));
      if (!status) continue;
      const date = colToDate(c);
      if (!date) continue;
      const inRaw = inRow >= 0 ? cell(rows, inRow, c) : null;
      const outRaw = outRow >= 0 ? cell(rows, outRow, c) : null;
      days.push({
        code,
        name,
        date,
        status,
        inTime: toHHMM(inRaw),
        outTime: toHHMM(outRaw),
        totalMinutes: totalRow >= 0 ? durationToMinutes(cell(rows, totalRow, c)) : 0,
        annotation: annotationFrom(inRaw, outRaw),
      });
    }
  }

  const dates = days.map((d) => d.date).sort();
  return {
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    days,
  };
}
