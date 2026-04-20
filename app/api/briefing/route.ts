import { NextResponse } from "next/server";
import { dbAll, dbGet, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type StaleLead = {
  lead_id: number;
  client_id: number;
  client_name: string;
  property_id: number;
  property_addr: string;
  status: string;
  last_contact_at: string;
  days_since: number;
  estimated_commission: number;
};

type MissingData = {
  id: number;
  address: string;
  city: string;
  missing: string[];
};

type CalendarItem = {
  id: number;
  title: string;
  type: string;
  start_time: string;
  end_time: string;
  client_id: number | null;
  client_name: string | null;
  property_id: number | null;
  property_address: string | null;
  location: string | null;
  notes: string | null;
};

type Opportunity = {
  client_id: number;
  client_name: string;
  preferred_locality: string | null;
  budget_min: number | null;
  budget_max: number | null;
  preferred_type: string | null;
  suggestion: string;
};

function daysBetween(from: string): number {
  const t = new Date(from).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function firstOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function nextMonth(d: Date): string {
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return firstOfMonth(n);
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }
function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
function dayBounds(d: Date): { from: string; to: string } {
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: toLocalIso(start), to: toLocalIso(end) };
}

export async function GET() {
  try {
    await ensureLocalReady();

    // URGENTNÍ FOLLOW-UPY — leady v aktivních fázích, last_contact_at >= 5 dní
    const staleRows = await dbAll<Omit<StaleLead, "days_since">>(
      `SELECT l.id AS lead_id, l.client_id, c.name AS client_name,
              l.property_id, p.address AS property_addr,
              l.status, l.last_contact_at,
              COALESCE(l.estimated_commission, 0) AS estimated_commission
       FROM leads l
       LEFT JOIN clients c ON c.id = l.client_id
       LEFT JOIN properties p ON p.id = l.property_id
       WHERE l.status IN ('nový','kontaktován','prohlídka','nabídka')
         AND l.last_contact_at IS NOT NULL
       ORDER BY l.last_contact_at ASC`,
    );

    const stale: StaleLead[] = staleRows
      .map((r) => ({ ...r, days_since: daysBetween(r.last_contact_at) }))
      .filter((r) => r.days_since >= 5)
      .slice(0, 20);

    // NEKOMPLETNÍ DATA — nemovitosti bez reconstruction_data NEBO building_modifications
    const missingRows = await dbAll<{
      id: number; address: string; city: string;
      reconstruction_data: string | null; building_modifications: string | null;
    }>(
      `SELECT id, address, city, reconstruction_data, building_modifications
       FROM properties
       WHERE status = 'aktivní'
         AND (reconstruction_data IS NULL OR building_modifications IS NULL)
       ORDER BY price DESC
       LIMIT 10`,
    );
    const missing: MissingData[] = missingRows.map((r) => {
      const m: string[] = [];
      if (!r.reconstruction_data) m.push("rekonstrukce");
      if (!r.building_modifications) m.push("stavební úpravy");
      return { id: r.id, address: r.address, city: r.city, missing: m };
    });

    // DNEŠNÍ ÚKOLY — události z kalendáře pro dnešní den, chronologicky
    const todayBounds = dayBounds(new Date());
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowBounds = dayBounds(tomorrow);

    const calSelect = `SELECT e.id, e.title, e.type, e.start_time, e.end_time,
                              e.client_id, c.name AS client_name,
                              e.property_id, p.address AS property_address,
                              e.location, e.notes
                       FROM calendar_events e
                       LEFT JOIN clients c ON c.id = e.client_id
                       LEFT JOIN properties p ON p.id = e.property_id
                       WHERE e.start_time >= ? AND e.start_time < ?
                       ORDER BY e.start_time ASC`;

    const todaysTasks = await dbAll<CalendarItem>(calSelect, [todayBounds.from, todayBounds.to]);
    const tomorrowsPreview = await dbAll<CalendarItem>(calSelect, [tomorrowBounds.from, tomorrowBounds.to]);

    // NOVÉ PŘÍLEŽITOSTI — klienti s vyplněnými preferencemi, kteří ještě nemají lead ve fázi nabídka/uzavřen
    const opps = await dbAll<{
      client_id: number; client_name: string;
      preferred_locality: string | null;
      budget_min: number | null; budget_max: number | null;
      preferred_type: string | null;
    }>(
      `SELECT c.id AS client_id, c.name AS client_name,
              c.preferred_locality, c.budget_min, c.budget_max, c.preferred_type
       FROM clients c
       WHERE c.preferred_locality IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM leads l
           WHERE l.client_id = c.id AND l.status IN ('nabídka','uzavřen')
         )
       ORDER BY c.budget_max DESC
       LIMIT 5`,
    );

    const opportunities: Opportunity[] = await Promise.all(opps.map(async (o) => {
      // Pokusí se najít 1–2 matching property.
      const params: unknown[] = [];
      let where = "status = 'aktivní'";
      if (o.preferred_type) { where += " AND type = ?"; params.push(o.preferred_type); }
      if (o.preferred_locality) {
        where += " AND (district LIKE ? OR city LIKE ?)";
        const like = `%${o.preferred_locality}%`;
        params.push(like, like);
      }
      if (o.budget_max) { where += " AND price <= ?"; params.push(Math.round(o.budget_max * 1.1)); }
      if (o.budget_min) { where += " AND price >= ?"; params.push(Math.round(o.budget_min * 0.8)); }

      const match = await dbGet<{ address?: string }>(
        `SELECT address FROM properties WHERE ${where} ORDER BY price LIMIT 1`,
        params,
      );

      const suggestion = match?.address
        ? `Vhodná nabídka: ${match.address}`
        : "Žádná přesná shoda — zvaž rozšíření nabídek nebo úpravu preferencí.";

      return {
        client_id: o.client_id,
        client_name: o.client_name,
        preferred_locality: o.preferred_locality,
        budget_min: o.budget_min,
        budget_max: o.budget_max,
        preferred_type: o.preferred_type,
        suggestion,
      };
    }));

    // PROVIZE — tento měsíc (realizované) + predikce (leady v nabídka/uzavřen)
    const now = new Date();
    const mStart = firstOfMonth(now);
    const mEnd = nextMonth(now);

    const realizedRow = (await dbGet<{ s: number; c: number }>(
      `SELECT COALESCE(SUM(commission), 0) AS s, COUNT(*) AS c
       FROM transactions
       WHERE transaction_date >= ? AND transaction_date < ?`,
      [mStart, mEnd],
    )) ?? { s: 0, c: 0 };

    const pipelineRow = (await dbGet<{ s: number; c: number }>(
      `SELECT COALESCE(SUM(l.estimated_commission), 0) AS s, COUNT(*) AS c
       FROM leads l
       WHERE l.status IN ('nabídka')`,
    )) ?? { s: 0, c: 0 };

    // Ohrožená provize = součet estimated_commission u stale leadů.
    const threatenedCommission = stale.reduce((a, b) => a + (b.estimated_commission || 0), 0);

    const summary = {
      urgent_count: stale.filter((s) => s.days_since >= 14).length,
      important_count: stale.filter((s) => s.days_since >= 7 && s.days_since < 14).length,
      watch_count: stale.filter((s) => s.days_since < 7).length,
      missing_data_count: missing.length,
      todays_tasks_count: todaysTasks.length,
      tomorrows_tasks_count: tomorrowsPreview.length,
      opportunities_count: opportunities.length,
      threatened_commission: threatenedCommission,
      realized_commission: realizedRow.s,
      realized_deals: realizedRow.c,
      pipeline_commission: pipelineRow.s,
      pipeline_deals: pipelineRow.c,
    };

    const anyUrgent = stale.length > 0 || missing.length > 0 || todaysTasks.length > 0;

    return NextResponse.json({
      anyUrgent,
      summary,
      followups: stale,
      missingData: missing,
      todaysTasks,
      tomorrowsPreview,
      opportunities,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
