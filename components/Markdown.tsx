"use client";

import { useCallback, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { InteractiveChart } from "./InteractiveChart";

function readEmailFromCard(btn: HTMLElement): { subject: string; body: string } | null {
  const card = btn.closest(".rk-email");
  if (!card) return null;
  const subjectEl = card.querySelector(".rk-email-subject");
  const bodyEl = card.querySelector(".rk-email-body");
  const subject = subjectEl?.textContent?.replace(/^Předmět:\s*/i, "").trim() ?? "";
  const body = bodyEl?.textContent?.trim() ?? "";
  return { subject, body };
}

function flashButton(btn: HTMLButtonElement, label: string, ms = 1800) {
  const prev = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { btn.textContent = prev; }, ms);
}

type BriefingPayload = {
  client_name: string;
  source: string;
  days: number;
  email: string;
  phone: string;
  pref: { type: string; locality: string; rooms: string; budget: string; notes: string };
  leads: Array<{ status: string; addr: string; price: number; commission: number; last_contact_days: number | null }>;
  active: Array<{ status: string; addr: string; next_action: string | null }>;
  matches: Array<{ address: string; type: string; area: number; price: number; score: number }>;
};

// jsPDF default font (Helvetica) nepodporuje české diakritiky. Transliterujeme
// na ASCII, aby se text spolehlivě vytiskl — i za cenu ztráty háčků/čárek.
const TRANSLIT_MAP: Record<string, string> = {
  "á":"a","č":"c","ď":"d","é":"e","ě":"e","í":"i","ň":"n","ó":"o","ř":"r","š":"s","ť":"t","ú":"u","ů":"u","ý":"y","ž":"z",
  "Á":"A","Č":"C","Ď":"D","É":"E","Ě":"E","Í":"I","Ň":"N","Ó":"O","Ř":"R","Š":"S","Ť":"T","Ú":"U","Ů":"U","Ý":"Y","Ž":"Z",
  "—":"-","–":"-",
  "\u201E":"\"","\u201C":"\"","\u201D":"\"","\u2018":"'","\u2019":"'",
};
function translit(s: string): string {
  let out = "";
  for (const ch of s) out += TRANSLIT_MAP[ch] ?? ch;
  return out;
}
function cz(n: number): string {
  return new Intl.NumberFormat("cs-CZ").format(n) + " Kc";
}

async function renderBriefingPdf(title: string, b64: string, fallbackCard: HTMLElement | null): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const MARGIN = 40;
  let y = 50;

  // Hlavička.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(37, 99, 235);
  doc.text("Realitka - Briefing klienta", MARGIN, y);
  y += 25;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(translit(title), MARGIN, y);
  y += 15;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(`Vygenerovano ${new Date().toLocaleDateString("cs-CZ")}`, MARGIN, y);
  y += 20;

  // Oddělovač.
  doc.setDrawColor(220, 220, 220);
  doc.line(MARGIN, y, W - MARGIN, y);
  y += 18;

  const writeSection = (header: string, lines: string[]) => {
    if (y > 780) { doc.addPage(); y = 50; }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(37, 99, 235);
    doc.text(translit(header), MARGIN, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    for (const line of lines) {
      const wrapped = doc.splitTextToSize(translit(line), W - MARGIN * 2);
      for (const w of wrapped as string[]) {
        if (y > 800) { doc.addPage(); y = 50; }
        doc.text(w, MARGIN, y);
        y += 13;
      }
    }
    y += 8;
  };

  // Pokud máme strukturovaná data, použij je (preferováno).
  let used = false;
  if (b64) {
    try {
      const payload = JSON.parse(atob(b64)) as BriefingPayload;
      used = true;

      writeSection("Kontakt", [
        `Klient: ${payload.client_name}  (zdroj: ${payload.source}, ${payload.days} dni v DB)`,
        `Email: ${payload.email}`,
        `Telefon: ${payload.phone}`,
      ]);

      writeSection("Co hleda", [
        `Typ: ${payload.pref.type}`,
        `Lokalita: ${payload.pref.locality}`,
        `Dispozice: ${payload.pref.rooms}`,
        `Rozpocet: ${payload.pref.budget}`,
        ...(payload.pref.notes ? [`Poznamka: ${payload.pref.notes}`] : []),
      ]);

      const leadLines = payload.leads.length === 0
        ? ["Zatim zadne leady."]
        : payload.leads.map((l) => {
          const d = l.last_contact_days === null ? "-" : `${l.last_contact_days} dni`;
          return `- [${l.status}] ${l.addr}  |  cena ${cz(l.price)}  |  provize ${cz(l.commission)}  |  posl. kontakt ${d}`;
        });
      writeSection(`Historie leadu (${payload.leads.length})`, leadLines);

      const activeLines = payload.active.length === 0
        ? ["Zadne aktivni leady."]
        : payload.active.map((l) => `- ${l.status} · ${l.addr}${l.next_action ? ` (dalsi krok: ${l.next_action})` : ""}`);
      writeSection(`Aktivni leady: ${payload.active.length}`, activeLines);

      const matchLines = payload.matches.length === 0
        ? ["Zadna idealni nabidka."]
        : payload.matches.map((m, i) => `${i + 1}. ${m.address} - ${m.type}, ${m.area} m2, ${cz(m.price)}  (shoda ${m.score}%)`);
      writeSection("Doporucene nabidky", matchLines);
    } catch (e) {
      console.warn("Briefing payload parse failed, fallback to DOM:", e);
    }
  }

  // Fallback: použij text z DOM karty.
  if (!used && fallbackCard) {
    const lines = (fallbackCard.innerText || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    writeSection("Briefing", lines);
  }

  const safe = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  doc.save(`briefing-${safe || "klient"}.pdf`);
}

function fmtPreviewTable(cols: string[], sample: Array<Record<string, string>>): string {
  if (!cols.length) return "";
  const head = "<tr>" + cols.map((c) => `<th>${c}</th>`).join("") + "</tr>";
  const body = sample
    .map((r) => "<tr>" + cols.map((c) => `<td>${(r[c] ?? "").toString().slice(0, 40)}</td>`).join("") + "</tr>")
    .join("");
  return `<table class="rk-csv-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

async function handleCsvPreview(card: HTMLElement, file: File) {
  const table = card.getAttribute("data-table") || "";
  const statusEl = card.querySelector(".rk-csv-status") as HTMLElement | null;
  const previewEl = card.querySelector(".rk-csv-preview") as HTMLElement | null;
  if (statusEl) statusEl.textContent = "Nahrávám…";
  if (previewEl) previewEl.innerHTML = "";
  const fd = new FormData();
  fd.append("table", table);
  fd.append("mode", "preview");
  fd.append("file", file);
  try {
    const res = await fetch("/api/import/csv", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (statusEl) statusEl.textContent = `Chyba: ${data.error ?? res.status}`;
      return;
    }
    card.setAttribute("data-filename", file.name);
    const blobKey = `rk_csv_blob_${Date.now()}`;
    (window as unknown as Record<string, unknown>)[blobKey] = file;
    card.setAttribute("data-blob-key", blobKey);
    if (statusEl) statusEl.textContent = `Nalezeno ${data.total} záznamů (oddělovač: "${data.delimiter}").`;
    if (previewEl) {
      const tableHtml = fmtPreviewTable(data.columns || [], data.sample || []);
      previewEl.innerHTML = `
        <div class="rk-csv-preview-head">Náhled prvních ${Math.min(5, data.total)} řádků:</div>
        ${tableHtml}
        <div class="rk-csv-confirm">
          <button class="rk-csv-commit" type="button">✅ Importovat ${data.total} záznamů</button>
          <button class="rk-csv-cancel" type="button">Zrušit</button>
        </div>`;
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Síťová chyba: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function handleCsvCommit(card: HTMLElement, btn: HTMLButtonElement) {
  const table = card.getAttribute("data-table") || "";
  const blobKey = card.getAttribute("data-blob-key") || "";
  const file = blobKey ? (window as unknown as Record<string, unknown>)[blobKey] as File | undefined : undefined;
  if (!file) { window.alert("Soubor již není dostupný, nahrajte znovu."); return; }
  const statusEl = card.querySelector(".rk-csv-status") as HTMLElement | null;
  btn.disabled = true;
  btn.textContent = "Importuji…";
  const fd = new FormData();
  fd.append("table", table);
  fd.append("mode", "commit");
  fd.append("file", file);
  try {
    const res = await fetch("/api/import/csv", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      if (statusEl) statusEl.textContent = `Chyba: ${data.error ?? res.status}`;
      btn.disabled = false;
      btn.textContent = "Zkusit znovu";
      return;
    }
    if (statusEl) {
      statusEl.textContent = `✅ Importováno ${data.inserted} z ${data.total} záznamů` +
        (data.error_count ? ` (${data.error_count} chyb)` : "");
    }
    const preview = card.querySelector(".rk-csv-preview") as HTMLElement | null;
    if (preview && data.errors?.length) {
      const errList = (data.errors as Array<{ row: number; error: string }>)
        .map((e) => `<li>Řádek ${e.row}: ${e.error}</li>`).join("");
      preview.innerHTML = `<div class="rk-csv-errors"><strong>Chyby při importu:</strong><ul>${errList}</ul></div>`;
    } else if (preview) {
      preview.innerHTML = "";
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = `Síťová chyba: ${err instanceof Error ? err.message : String(err)}`;
    btn.disabled = false;
    btn.textContent = "Zkusit znovu";
  }
}

export function Markdown({ content }: { content: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onChange = (e: Event) => {
      const t = e.target as HTMLElement;
      if (!(t instanceof HTMLInputElement)) return;
      if (!t.classList.contains("rk-csv-input")) return;
      const card = t.closest(".rk-csv-import") as HTMLElement | null;
      const file = t.files?.[0];
      if (!card || !file) return;
      handleCsvPreview(card, file);
    };
    root.addEventListener("change", onChange);
    return () => root.removeEventListener("change", onChange);
  }, [content]);

  const onClick = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    // Copy button
    const copyBtn = target.closest(".rk-email-copy") as HTMLButtonElement | null;
    if (copyBtn) {
      e.preventDefault();
      const parsed = readEmailFromCard(copyBtn);
      if (!parsed) return;
      const { subject, body } = parsed;
      const txt = subject ? `Předmět: ${subject}\n\n${body}` : body;
      try {
        await navigator.clipboard.writeText(txt);
        flashButton(copyBtn, "Zkopírováno ✓");
      } catch {
        flashButton(copyBtn, "Chyba kopírování");
      }
      return;
    }

    // Edit button — hodí předmět + tělo do chat inputu přes vlastní událost
    const editBtn = target.closest(".rk-email-edit") as HTMLButtonElement | null;
    if (editBtn) {
      e.preventDefault();
      const parsed = readEmailFromCard(editBtn);
      if (!parsed) return;
      const detail = {
        text: `Uprav tento email a pak ho odešli:\n\nPředmět: ${parsed.subject}\n\n${parsed.body}`,
      };
      window.dispatchEvent(new CustomEvent("rk:fill-input", { detail }));
      flashButton(editBtn, "Vloženo ✓");
      return;
    }

    // CSV import: potvrdit/zrušit
    const csvCommit = target.closest(".rk-csv-commit") as HTMLButtonElement | null;
    if (csvCommit) {
      e.preventDefault();
      const card = csvCommit.closest(".rk-csv-import") as HTMLElement | null;
      if (card) await handleCsvCommit(card, csvCommit);
      return;
    }
    const csvCancel = target.closest(".rk-csv-cancel") as HTMLButtonElement | null;
    if (csvCancel) {
      e.preventDefault();
      const card = csvCancel.closest(".rk-csv-import") as HTMLElement | null;
      if (card) {
        const preview = card.querySelector(".rk-csv-preview") as HTMLElement | null;
        const statusEl = card.querySelector(".rk-csv-status") as HTMLElement | null;
        if (preview) preview.innerHTML = "";
        if (statusEl) statusEl.textContent = "Zrušeno.";
      }
      return;
    }

    // Generic "fill input" button (follow-up cards, match cards) — vezme data-fill a vloží ho.
    const fillBtn = target.closest(".rk-fill-btn") as HTMLButtonElement | null;
    if (fillBtn) {
      e.preventDefault();
      const text = fillBtn.getAttribute("data-fill") || "";
      if (!text) return;
      window.dispatchEvent(new CustomEvent("rk:fill-input", { detail: { text } }));
      flashButton(fillBtn, "Vloženo ✓");
      return;
    }

    // Briefing PDF export.
    const briefPdfBtn = target.closest(".rk-brief-pdf") as HTMLButtonElement | null;
    if (briefPdfBtn) {
      e.preventDefault();
      const title = briefPdfBtn.getAttribute("data-brief-pdf") || "Briefing";
      const b64 = briefPdfBtn.getAttribute("data-brief-json") || "";
      const prev = briefPdfBtn.textContent;
      briefPdfBtn.disabled = true;
      briefPdfBtn.textContent = "Generuji…";
      try {
        await renderBriefingPdf(title, b64, briefPdfBtn.closest(".rk-brief") as HTMLElement | null);
        flashButton(briefPdfBtn, "Staženo ✓");
      } catch (err) {
        console.error("PDF error:", err);
        flashButton(briefPdfBtn, "Chyba PDF");
        window.alert(`Chyba při generování PDF: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        briefPdfBtn.disabled = false;
        if (briefPdfBtn.textContent === "Generuji…") briefPdfBtn.textContent = prev;
      }
      return;
    }

    // Send button — POST na /api/gmail/send
    const sendBtn = target.closest(".rk-email-send") as HTMLButtonElement | null;
    if (sendBtn) {
      e.preventDefault();
      const parsed = readEmailFromCard(sendBtn);
      if (!parsed) return;
      const to = window.prompt("Zadejte email příjemce:", "");
      if (!to) return;
      sendBtn.disabled = true;
      const prev = sendBtn.textContent;
      sendBtn.textContent = "Odesílám…";
      try {
        const user = localStorage.getItem("gmail_user") || "";
        const password = localStorage.getItem("gmail_app_password") || "";
        const res = await fetch("/api/gmail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to,
            subject: parsed.subject,
            body: parsed.body,
            ...(user ? { user } : {}),
            ...(password ? { password } : {}),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          sendBtn.textContent = "Odesláno ✓";
          sendBtn.classList.add("rk-email-sent");
        } else {
          sendBtn.textContent = "Chyba";
          window.alert(`Odeslání selhalo: ${data.error || res.status}`);
          setTimeout(() => { sendBtn.textContent = prev; sendBtn.disabled = false; }, 2000);
        }
      } catch (err) {
        sendBtn.textContent = "Chyba";
        window.alert(`Síťová chyba: ${err instanceof Error ? err.message : String(err)}`);
        setTimeout(() => { sendBtn.textContent = prev; sendBtn.disabled = false; }, 2000);
      }
      return;
    }
  }, []);

  return (
    <div ref={rootRef} className="markdown" onClick={onClick}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
          img: ({ node, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
            <img {...props} loading="lazy" />
          ),
          div: ({ node, className, ...props }) => {
            const classes = typeof className === "string" ? className : "";
            if (classes.includes("rk-chart-mount")) {
              const dataChart = (props as Record<string, unknown>)["data-chart"];
              const dataFallback = (props as Record<string, unknown>)["data-fallback"];
              const dataTitle = (props as Record<string, unknown>)["data-title"];
              if (typeof dataChart === "string" && dataChart.length > 0) {
                return (
                  <InteractiveChart
                    specB64={dataChart}
                    fallbackUrl={typeof dataFallback === "string" ? dataFallback : undefined}
                    title={typeof dataTitle === "string" ? dataTitle : undefined}
                  />
                );
              }
            }
            return <div className={className} {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
