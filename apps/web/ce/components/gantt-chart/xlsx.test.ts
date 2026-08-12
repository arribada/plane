/**
 * Copyright (c) 2026-present Arribada Initiative and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * The .xlsx writer, checked at the level a corrupt one would fail at.
 *
 * There is no unzip in the test environment, and that turns out not to matter:
 * the entries are STORED, so every part's XML is literally present in the bytes
 * and can be read straight out of them. What cannot be read that way — the CRCs,
 * the central directory offsets — is what a spreadsheet rejects the file over, so
 * the structural assertions below are the ones worth having.
 *
 * The output is also pinned as deterministic. A DOS timestamp of "now" would
 * make the same plan produce different bytes on every export, and nothing about
 * the mtime inside a workbook is information anybody uses.
 */
import { describe, expect, it } from "vitest";
import { buildXlsx, columnName, XLSX_MIME } from "./xlsx";

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const u32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint32(at, true);
const u16 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset).getUint16(at, true);

/** The end-of-central-directory record is the last 22 bytes when, as here, no
 *  archive comment is written. */
const eocdAt = (bytes: Uint8Array) => bytes.length - 22;

const SIMPLE = [
  {
    name: "Work items",
    headerRow: true,
    widths: [12, 40],
    notes: ["MARLIN — timeline", "3 collapsed groups are folded shut."],
    rows: [
      ["Key", "Name", "Start", "Days"],
      ["ARB-1", "Bring-up", new Date(Date.UTC(2026, 7, 3)), 5],
      ["ARB-2", "Café — “cold” soak & <hot>", new Date(Date.UTC(2026, 7, 10)), 3],
    ],
  },
];

describe("the package", () => {
  it("is a ZIP whose directory agrees with its entries", () => {
    const bytes = buildXlsx(SIMPLE);

    expect(u32(bytes, 0)).toBe(0x04034b50); // first local file header
    const end = eocdAt(bytes);
    expect(u32(bytes, end)).toBe(0x06054b50); // end of central directory
    // Five fixed parts plus one worksheet.
    expect(u16(bytes, end + 8)).toBe(6);
    expect(u16(bytes, end + 10)).toBe(6);
    // The directory starts where it says it does, and is as long as it says.
    const directoryAt = u32(bytes, end + 16);
    expect(u32(bytes, directoryAt)).toBe(0x02014b50);
    expect(u32(bytes, end + 12)).toBe(end - directoryAt);
  });

  it("carries every part OOXML requires", () => {
    const body = text(buildXlsx(SIMPLE));
    for (const part of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
    ])
      expect(body).toContain(part);
  });

  it("is byte-for-byte reproducible", () => {
    expect(Array.from(buildXlsx(SIMPLE))).toEqual(Array.from(buildXlsx(SIMPLE)));
  });

  it("declares the modern spreadsheet mime type", () => {
    expect(XLSX_MIME).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  });
});

describe("the cells", () => {
  it("writes dates as Excel serials, not as strings", () => {
    // 2026-08-03 is 46237 days after 1899-12-30. If this drifts by one, every
    // exported plan is a day out.
    expect(text(buildXlsx(SIMPLE))).toContain("<v>46237</v>");
  });

  it("reads a date in UTC, so an exporter west of Greenwich is not a day early", () => {
    const bytes = buildXlsx([{ name: "S", rows: [[new Date("2026-08-03T00:00:00Z")]] }]);
    expect(text(bytes)).toContain("<v>46237</v>");
  });

  it("writes numbers as numbers", () => {
    const body = text(buildXlsx(SIMPLE));
    expect(body).toContain("<v>5</v>");
    expect(body).toContain("<v>3</v>");
  });

  it("cannot emit a formula, whatever the text begins with", () => {
    const bytes = buildXlsx([{ name: "S", rows: [["=cmd|' /C calc'!A0", "@SUM(A1:A9)", "-1250"]] }]);
    const body = text(bytes);
    // A formula in OOXML is an <f> element. Inline strings are text, full stop —
    // which is why this format needs no escaping rule the way the CSV does.
    expect(body).not.toContain("<f>");
    expect(body).toContain("=cmd|' /C calc'!A0");
    expect(body).toContain('t="inlineStr"');
  });

  it("escapes XML and drops the control characters XML cannot carry", () => {
    // Built rather than typed: a literal NUL or BEL in a source file is
    // invisible in every editor and survives exactly one careless copy-paste.
    const NUL = String.fromCharCode(0);
    const BEL = String.fromCharCode(7);
    const body = text(buildXlsx([{ name: "S", rows: [[`a & b < c > d "e"${NUL}${BEL} f`]] }]));

    expect(body).toContain("a &amp; b &lt; c &gt; d &quot;e&quot; f");
    // Scoped to where they were, not to the whole package: a ZIP's own headers
    // are full of NUL bytes, so a blanket search proves nothing either way.
    expect(body).not.toContain(`&quot;${NUL}`);
    expect(body).not.toContain(`&quot;${BEL}`);
  });

  it("omits an empty cell rather than writing a blank one", () => {
    const body = text(buildXlsx([{ name: "S", rows: [["a", null, undefined, "", "b"]] }]));
    expect(body).toContain('<row r="1"><c r="A1"');
    expect(body).not.toContain('r="B1"');
    expect(body).toContain('r="E1"');
  });

  it("keeps a non-finite number out of the numeric cells", () => {
    const body = text(buildXlsx([{ name: "S", rows: [[Number.NaN, Number.POSITIVE_INFINITY]] }]));
    expect(body).not.toContain("<v>NaN</v>");
    expect(body).toContain("NaN");
  });
});

describe("the sheets", () => {
  it("freezes below the notes and the header, and filters from the header", () => {
    const body = text(buildXlsx(SIMPLE));
    // Two notes then the header: rows 1-3 stay put, the table starts at row 4.
    expect(body).toContain('ySplit="3" topLeftCell="A4"');
    expect(body).toContain('<autoFilter ref="A3:D5"/>');
  });

  it("adds neither when there is no header row", () => {
    const body = text(buildXlsx([{ name: "S", rows: [["a"]] }]));
    expect(body).not.toContain("autoFilter");
    expect(body).not.toContain("sheetViews");
  });

  it("sanitises a tab name Excel would refuse and de-duplicates collisions", () => {
    const body = text(
      buildXlsx([
        { name: "Q1/Q2: [draft]", rows: [["a"]] },
        { name: "Q1/Q2: [draft]", rows: [["b"]] },
      ])
    );
    expect(body).toContain('name="Q1 Q2   draft"');
    expect(body).toContain('name="Q1 Q2   draft 2"');
  });

  it("relates each sheet to its own part, with the stylesheet last", () => {
    const body = text(
      buildXlsx([
        { name: "One", rows: [["a"]] },
        { name: "Two", rows: [["b"]] },
      ])
    );
    // builds the one relationship string this test asserts on; it belongs next to the assertion.
    // oxlint-disable-next-line unicorn/consistent-function-scoping
    const rel = (id: number, target: string, kind: string) =>
      `Id="rId${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"`;
    expect(body).toContain(rel(1, "worksheets/sheet1.xml", "worksheet"));
    expect(body).toContain(rel(2, "worksheets/sheet2.xml", "worksheet"));
    expect(body).toContain(rel(3, "styles.xml", "styles"));
  });
});

describe("columnName", () => {
  it("counts the way a spreadsheet does", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
    expect(columnName(701)).toBe("ZZ");
  });
});
