import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Tpl = { filename: string; rows: string[][] };

const TEMPLATES: Record<string, Tpl> = {
  clients: {
    filename: "klienti_sablona.csv",
    rows: [
      ["Jméno", "Email", "Telefon", "Zdroj", "Rozpočet od", "Rozpočet do", "Preferovaná lokalita", "Dispozice", "Typ", "Poznámky"],
      ["Jan Novák", "jan.novak@example.cz", "777123456", "web", "4000000", "6000000", "Praha 7", "3+kk", "byt", "Hledá nejpozději do léta."],
      ["Eva Dvořáková", "eva.dvorakova@example.cz", "603987654", "doporučení", "8000000", "12000000", "Brno-střed", "4+1", "byt", "Preferuje novostavbu."],
    ],
  },
  properties: {
    filename: "nemovitosti_sablona.csv",
    rows: [
      ["Adresa", "Město", "Čtvrť", "Typ", "Cena", "Plocha m2", "Pokoje", "Stav", "Popis"],
      ["Janovského 12", "Praha", "Praha 7", "byt", "5900000", "78", "3", "aktivní", "Byt 3+kk po rekonstrukci, 5. patro s výtahem."],
      ["Lidická 44", "Brno", "Brno-střed", "byt", "7500000", "92", "4", "aktivní", "Prostorný byt 4+1 s lodžií."],
    ],
  },
  leads: {
    filename: "leady_sablona.csv",
    rows: [
      ["Klient", "Nemovitost", "Stav", "Zdroj", "Datum posledního kontaktu", "Další krok", "Odhad provize"],
      ["Jan Novák", "Janovského 12", "kontaktován", "web", "2026-04-15", "Prohlídka 20.4.", "150000"],
      ["Eva Dvořáková", "Lidická 44", "prohlídka", "doporučení", "2026-04-17", "Domluvit druhou prohlídku", "220000"],
    ],
  },
};

function toCsv(rows: string[][]): string {
  const esc = (v: string) => {
    if (/[,"\n;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const table = url.searchParams.get("table") ?? "";
  const tpl = TEMPLATES[table];
  if (!tpl) {
    return NextResponse.json(
      { ok: false, error: "table musí být clients/properties/leads." },
      { status: 400 },
    );
  }
  const csv = toCsv(tpl.rows);
  // UTF-8 BOM, aby Excel správně zobrazil diakritiku.
  const body = "\uFEFF" + csv;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${tpl.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
