/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * A real .xlsx, written by hand.
 *
 * "Export to Excel" was the one format missing, and the two cheap ways of
 * faking it are both worse than not having it. A .csv renamed .xls opens with a
 * "the file format does not match the extension" warning every single time.
 * SpreadsheetML 2003 is plain XML and needs no zip, but modern Excel gives it
 * the same warning unless it is named .xml, which nobody recognises as a
 * spreadsheet.
 *
 * So this writes the actual OOXML package: a ZIP holding `[Content_Types].xml`,
 * a workbook, a stylesheet and one worksheet part per sheet. It opens silently
 * in Excel, LibreOffice, Numbers and Google Sheets. Roughly 250 lines against a
 * 900 KB dependency, and the timeline is the only thing in the fork that needs
 * it.
 *
 * Two properties worth stating because they are the reason for the shape:
 *
 * - **Typed cells.** A date is a date and a number is a number, so the reader
 *   can sort, filter and subtract them. A screenshot pasted into a cell — or a
 *   CSV where every column is text — is what this exists to replace.
 * - **No formula can enter.** Strings are written as `t="inlineStr"`, and a
 *   formula in OOXML is an `<f>` element. A cell whose text begins `=` or `@`
 *   is text, permanently, with no escaping rule to get wrong. The CSV path has
 *   to defend against that by hand (see `cell` in export.ts); this one cannot
 *   be attacked at all.
 *
 * Stored, not deflated. The parts are a few tens of kilobytes of XML and adding
 * a DEFLATE implementation to save some of that is not a trade worth making;
 * every unzip implementation reads method 0.
 */

export type TCellValue = string | number | Date | null | undefined;

export type TSheet = {
  /** Excel's own limits: 31 characters, and none of `[]:*?/\`. Trimmed here. */
  name: string;
  /** Row 0 is the header when `headerRow` is true — bold, frozen, filterable. */
  rows: TCellValue[][];
  headerRow?: boolean;
  /** Character widths, one per column. Missing entries take Excel's default. */
  widths?: number[];
  /**
   * Free text placed above the table, one row each, in grey italics — the same
   * provenance the CSV carries as `#` comments. A spreadsheet has no comment
   * syntax, so these are cells, and the header row counts from after them.
   */
  notes?: string[];
};

/* ------------------------------------------------------------------ ZIP --- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

type TEntry = { name: string; size: number; crc: number; offset: number };

/**
 * A store-only ZIP. Timestamps are pinned to the DOS epoch (1980-01-01) rather
 * than `Date.now()` so the same workbook produces the same bytes — which is
 * what makes it testable at all, and costs nothing: the mtime inside an export
 * is not information anybody uses.
 */
const zip = (files: { name: string; text: string }[]): Uint8Array => {
  const entries: TEntry[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;

  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    offset += bytes.length;
  };

  for (const file of files) {
    const nameBytes = utf8(file.name);
    const bytes = utf8(file.text);
    const crc = crc32(bytes);
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true); // local file header
    header.setUint16(4, 20, true); // version needed
    header.setUint16(6, 0x0800, true); // bit 11: names are UTF-8
    header.setUint16(8, 0, true); // method 0 = stored
    header.setUint16(10, 0, true); // time
    header.setUint16(12, 0x0021, true); // date = 1980-01-01
    header.setUint32(14, crc, true);
    header.setUint32(18, bytes.length, true);
    header.setUint32(22, bytes.length, true);
    header.setUint16(26, nameBytes.length, true);
    header.setUint16(28, 0, true); // extra field length

    entries.push({ name: file.name, size: bytes.length, crc, offset });
    push(new Uint8Array(header.buffer));
    push(nameBytes);
    push(bytes);
  }

  const centralStart = offset;
  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const record = new DataView(new ArrayBuffer(46));
    record.setUint32(0, 0x02014b50, true); // central directory header
    record.setUint16(4, 20, true); // version made by
    record.setUint16(6, 20, true); // version needed
    record.setUint16(8, 0x0800, true);
    record.setUint16(10, 0, true);
    record.setUint16(12, 0, true);
    record.setUint16(14, 0x0021, true);
    record.setUint32(16, entry.crc, true);
    record.setUint32(20, entry.size, true);
    record.setUint32(24, entry.size, true);
    record.setUint16(28, nameBytes.length, true);
    record.setUint32(42, entry.offset, true); // local header offset
    push(new Uint8Array(record.buffer));
    push(nameBytes);
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, offset - centralStart, true);
  end.setUint32(16, centralStart, true);
  push(new Uint8Array(end.buffer));

  const out = new Uint8Array(offset);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

/* ---------------------------------------------------------------- OOXML --- */

/**
 * XML 1.0 cannot carry the C0 controls, and a work item name pasted out of a
 * terminal or a GitHub issue body can hold them. Stripping them beats handing
 * over a file Excel opens with "we found a problem with some content".
 *
 * Built from a string rather than written as a regex literal so this source file
 * itself stays free of control characters — a literal here is invisible in every
 * editor and survives exactly one careless copy-paste. Tab, newline and carriage
 * return are legal in XML and are kept.
 */
// matching control characters is the entire purpose: they are illegal in XML 1.0 and Excel refuses the file.
// oxlint-disable-next-line no-control-regex
const CONTROL_CHARS = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");

const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(CONTROL_CHARS, "");

/**
 * Excel's serial day: whole days since 1899-12-30.
 *
 * Read in UTC, deliberately. A work item carries a DAY — `2026-08-03` — and the
 * exporters build it with `new Date("2026-08-03")`, which is UTC midnight. Ask
 * that object for its LOCAL parts anywhere west of Greenwich and it answers
 * "2 August", so a plan exported from Boston would have every date in it a day
 * early. `iso()` in export.ts reads UTC for exactly the same reason; this has to
 * agree with it or the CSV and the workbook would disagree about the same row.
 */
const serial = (d: Date): number => {
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((midnight - Date.UTC(1899, 11, 30)) / 86_400_000);
};

/** A1, B1 ... Z1, AA1. */
export const columnName = (index: number): string => {
  let name = "";
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
};

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_DATE = 2;
const STYLE_NOTE = 3;

const cellXml = (ref: string, value: TCellValue, style: number): string => {
  if (value === null || value === undefined || value === "") {
    return style === STYLE_DEFAULT ? "" : `<c r="${ref}" s="${style}"/>`;
  }
  const s = style === STYLE_DEFAULT ? "" : ` s="${style}"`;
  if (value instanceof Date) return `<c r="${ref}" s="${STYLE_DATE}"><v>${serial(value)}</v></c>`;
  if (typeof value === "number") {
    // NaN and Infinity have no OOXML spelling; they become text rather than a
    // cell Excel reports as corrupt.
    if (Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t>${xml(String(value))}</t></is></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
};

const sheetXml = (sheet: TSheet): string => {
  const notes = sheet.notes ?? [];
  const headerAt = sheet.headerRow ? notes.length : -1;
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  ];

  // Freeze everything down to and including the header, so scrolling a
  // four-hundred-row plan keeps the column names in sight. Must precede <cols>
  // and <sheetData>: the schema fixes the order and Excel enforces it.
  if (headerAt >= 0) {
    const firstDataRow = headerAt + 2;
    parts.push(
      `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${firstDataRow - 1}" topLeftCell="A${firstDataRow}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    );
  }

  if (sheet.widths?.length) {
    const cols = sheet.widths
      .map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`)
      .join("");
    parts.push(`<cols>${cols}</cols>`);
  }

  parts.push("<sheetData>");
  let rowNumber = 0;
  for (const note of notes) {
    rowNumber += 1;
    parts.push(`<row r="${rowNumber}">${cellXml(`A${rowNumber}`, note, STYLE_NOTE)}</row>`);
  }
  sheet.rows.forEach((row, rowIndex) => {
    rowNumber += 1;
    const style = rowIndex === 0 && sheet.headerRow ? STYLE_HEADER : STYLE_DEFAULT;
    const cells = row.map((value, colIndex) => cellXml(`${columnName(colIndex)}${rowNumber}`, value, style)).join("");
    parts.push(`<row r="${rowNumber}">${cells}</row>`);
  });
  parts.push("</sheetData>");

  // The filter dropdowns. Worth the four lines: the first thing anybody does
  // with a plan in a spreadsheet is narrow it to one sprint or one owner.
  if (headerAt >= 0 && sheet.rows.length > 0) {
    const lastCol = columnName(Math.max(0, (sheet.rows[0]?.length ?? 1) - 1));
    parts.push(`<autoFilter ref="A${headerAt + 1}:${lastCol}${rowNumber}"/>`);
  }

  parts.push("</worksheet>");
  return parts.join("");
};

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="3">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Excel rejects `[]:*?/\` in a tab name, silently truncates past 31, and will
 *  not open a workbook holding two tabs of the same name. */
const sheetName = (raw: string, index: number, taken: Set<string>): string => {
  const base =
    (raw || `Sheet${index + 1}`)
      .replace(/[[\]:*?/\\]/g, " ")
      .slice(0, 31)
      .trim() || `Sheet${index + 1}`;
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base.slice(0, 28)} ${n++}`;
  taken.add(name.toLowerCase());
  return name;
};

/** The workbook, as the bytes of a .xlsx file. */
export const buildXlsx = (sheets: TSheet[]): Uint8Array => {
  const used = new Set<string>();
  const named = sheets.map((sheet, i) => ({ ...sheet, name: sheetName(sheet.name, i, used) }));

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    ...named.map(
      (_s, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ),
    "</Types>",
  ].join("");

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<sheets>" +
    named.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    named
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
      )
      .join("") +
    `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  return zip([
    { name: "[Content_Types].xml", text: contentTypes },
    { name: "_rels/.rels", text: rootRels },
    { name: "xl/workbook.xml", text: workbook },
    { name: "xl/_rels/workbook.xml.rels", text: workbookRels },
    { name: "xl/styles.xml", text: STYLES_XML },
    ...named.map((sheet, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(sheet) })),
  ]);
};

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
