"use client";

import { useMemo, useState } from "react";

function containsTable(text: string): boolean {
  // Detekce markdown tabulky (|…| na jednom řádku, separator line)
  return /\n\s*\|[^\n]*\|\s*\n\s*\|[\s:-]*\|/.test("\n" + text);
}

type ParsedTable = {
  headers: string[];
  rows: string[][];
};

function parseMarkdownTables(text: string): ParsedTable[] {
  const lines = text.split(/\r?\n/);
  const tables: ParsedTable[] = [];
  let i = 0;
  while (i < lines.length) {
    const header = lines[i];
    const sep = lines[i + 1];
    if (
      header && sep &&
      /^\s*\|.*\|\s*$/.test(header) &&
      /^\s*\|[\s:\-|]+\|\s*$/.test(sep)
    ) {
      const headers = header.trim().slice(1, -1).split("|").map((s) => s.trim());
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        rows.push(lines[j].trim().slice(1, -1).split("|").map((s) => s.trim()));
        j++;
      }
      if (rows.length > 0) tables.push({ headers, rows });
      i = j;
    } else {
      i++;
    }
  }
  return tables;
}

function czDateTime(): string {
  const d = new Date();
  return d.toLocaleString("cs-CZ");
}

async function downloadPdf(text: string, title: string) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  // Hlavička
  doc.setFillColor(37, 99, 235);
  doc.rect(0, 0, pageW, 18, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("REALITKA", margin, 12);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(czDateTime(), pageW - margin, 12, { align: "right" });
  y = 26;

  // Titulek
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(title, pageW - 2 * margin);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 6 + 4;

  // Tělo
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  // Jednoduchá textová verze — strip HTML tagy a markdown značky.
  const clean = text
    .replace(/<[^>]*>/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const bodyLines = doc.splitTextToSize(clean, pageW - 2 * margin);
  const lineHeight = 5;
  for (const line of bodyLines) {
    if (y > 280) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  // Patička
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Strana ${i} / ${pageCount} · Realitka Back Office Agent`, pageW / 2, 290, { align: "center" });
  }

  const fname = `realitka-report-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(fname);
}

async function downloadExcel(tables: ParsedTable[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  tables.forEach((t, idx) => {
    const aoa = [t.headers, ...t.rows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // Nastavení šířky sloupců.
    const colWidths = t.headers.map((h, ci) => {
      const maxLen = Math.max(h.length, ...t.rows.map((r) => (r[ci] ?? "").length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
    });
    (ws as any)["!cols"] = colWidths;
    // AutoFilter na header row.
    const range = XLSX.utils.decode_range(ws["!ref"] as string);
    (ws as any)["!autofilter"] = { ref: XLSX.utils.encode_range({ s: range.s, e: { c: range.e.c, r: 0 } }) };
    const sheetName = `Tabulka ${idx + 1}`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });
  const fname = `realitka-data-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, fname);
}

export function MessageExportButtons({ text, title }: { text: string; title?: string }) {
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const tables = useMemo(() => parseMarkdownTables(text), [text]);
  const hasTable = tables.length > 0 || containsTable(text);
  if (!hasTable) return null;

  const displayTitle = title || "Realitka · Report";

  const onPdf = async () => {
    setBusy("pdf");
    try { await downloadPdf(text, displayTitle); }
    catch (e) { window.alert(`PDF export selhal: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };

  const onXlsx = async () => {
    if (tables.length === 0) {
      window.alert("V odpovědi nebyla detekována žádná tabulka.");
      return;
    }
    setBusy("xlsx");
    try { await downloadExcel(tables); }
    catch (e) { window.alert(`Excel export selhal: ${e instanceof Error ? e.message : String(e)}`); }
    finally { setBusy(null); }
  };

  return (
    <div className="rk-export-bar">
      <button
        type="button"
        onClick={onPdf}
        disabled={busy !== null}
        className="rk-export-btn rk-export-pdf"
        title="Stáhnout odpověď jako PDF"
      >
        {busy === "pdf" ? "Generuji…" : "📄 Stáhnout PDF"}
      </button>
      <button
        type="button"
        onClick={onXlsx}
        disabled={busy !== null}
        className="rk-export-btn rk-export-xlsx"
        title="Stáhnout tabulky jako Excel"
      >
        {busy === "xlsx" ? "Generuji…" : "📊 Stáhnout Excel"}
      </button>
    </div>
  );
}
