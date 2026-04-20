import { NextResponse } from "next/server";
import { dbGet, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Count = { c: number };
type Sum = { s: number | null };

function firstOfMonth(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function firstOfPrevMonth(d: Date): string {
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return firstOfMonth(prev);
}

function pctChange(curr: number, prev: number): number {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function trend(delta: number): "up" | "down" | "flat" {
  if (delta > 2) return "up";
  if (delta < -2) return "down";
  return "flat";
}

export async function GET() {
  try {
    await ensureLocalReady();

    const now = new Date();
    const thisMonthStart = firstOfMonth(now);
    const prevMonthStart = firstOfPrevMonth(now);

    const sumOf = async (sql: string, args: unknown[] = []): Promise<number> =>
      (await dbGet<Sum>(sql, args))?.s ?? 0;
    const countOf = async (sql: string, args: unknown[] = []): Promise<number> =>
      (await dbGet<Count>(sql, args))?.c ?? 0;

    // Portfolio hodnota (aktivní nemovitosti).
    const portfolioValue = await sumOf(
      `SELECT COALESCE(SUM(price), 0) AS s FROM properties WHERE status = 'aktivní'`,
    );

    // Aktivní nemovitosti.
    const activeProperties = await countOf(
      `SELECT COUNT(*) AS c FROM properties WHERE status = 'aktivní'`,
    );

    // Otevřené leady (status != 'uzavřen').
    const openLeads = await countOf(
      `SELECT COUNT(*) AS c FROM leads WHERE status != 'uzavřen'`,
    );

    // Konverzní poměr (uzavřené / celkové).
    const totalLeads = await countOf(`SELECT COUNT(*) AS c FROM leads`);
    const closedLeads = await countOf(
      `SELECT COUNT(*) AS c FROM leads WHERE status = 'uzavřen'`,
    );
    const conversionRate = totalLeads > 0
      ? Math.round((closedLeads / totalLeads) * 1000) / 10
      : 0;

    // Tržby aktuální měsíc.
    const monthlyRevenue = await sumOf(
      `SELECT COALESCE(SUM(sale_price), 0) AS s FROM transactions
       WHERE transaction_date >= ? AND transaction_date < ?`,
      [thisMonthStart, nextMonth(now)],
    );

    // Tržby minulý měsíc (pro trend).
    const prevMonthlyRevenue = await sumOf(
      `SELECT COALESCE(SUM(sale_price), 0) AS s FROM transactions
       WHERE transaction_date >= ? AND transaction_date < ?`,
      [prevMonthStart, thisMonthStart],
    );

    // Noví klienti aktuální měsíc.
    const newClients = await countOf(
      `SELECT COUNT(*) AS c FROM clients
       WHERE created_at >= ? AND created_at < ?`,
      [thisMonthStart, nextMonth(now)],
    );

    const prevNewClients = await countOf(
      `SELECT COUNT(*) AS c FROM clients
       WHERE created_at >= ? AND created_at < ?`,
      [prevMonthStart, thisMonthStart],
    );

    // Minulý měsíc srovnání pro portfolio/leady — schéma snapshot neexistuje,
    // takže použijeme heuristiku na základě properties.created_at a leads.created_at.
    const prevActiveProperties = await countOf(
      `SELECT COUNT(*) AS c FROM properties
       WHERE status = 'aktivní' AND created_at < ?`,
      [thisMonthStart],
    );

    const prevOpenLeads = await countOf(
      `SELECT COUNT(*) AS c FROM leads
       WHERE status != 'uzavřen' AND created_at < ?`,
      [thisMonthStart],
    );

    const prevPortfolioValue = await sumOf(
      `SELECT COALESCE(SUM(price), 0) AS s FROM properties
       WHERE status = 'aktivní' AND created_at < ?`,
      [thisMonthStart],
    );

    const prevClosedLeads = await countOf(
      `SELECT COUNT(*) AS c FROM leads
       WHERE status = 'uzavřen' AND created_at < ?`,
      [thisMonthStart],
    );
    const prevTotalLeads = await countOf(
      `SELECT COUNT(*) AS c FROM leads WHERE created_at < ?`,
      [thisMonthStart],
    );
    const prevConversionRate = prevTotalLeads > 0
      ? Math.round((prevClosedLeads / prevTotalLeads) * 1000) / 10
      : 0;

    const portfolioDelta = pctChange(portfolioValue, prevPortfolioValue);
    const activeDelta = pctChange(activeProperties, prevActiveProperties);
    const leadsDelta = pctChange(openLeads, prevOpenLeads);
    const conversionDelta = Math.round((conversionRate - prevConversionRate) * 10) / 10;
    const revenueDelta = pctChange(monthlyRevenue, prevMonthlyRevenue);
    const clientsDelta = pctChange(newClients, prevNewClients);

    return NextResponse.json({
      portfolioValue,
      portfolioValueDelta: portfolioDelta,
      portfolioValueTrend: trend(portfolioDelta),
      activeProperties,
      activePropertiesDelta: activeDelta,
      activePropertiesTrend: trend(activeDelta),
      openLeads,
      openLeadsDelta: leadsDelta,
      openLeadsTrend: trend(leadsDelta),
      conversionRate,
      conversionRateDelta: conversionDelta,
      conversionRateTrend: trend(conversionDelta),
      monthlyRevenue,
      monthlyRevenueDelta: revenueDelta,
      monthlyRevenueTrend: trend(revenueDelta),
      newClients,
      newClientsDelta: clientsDelta,
      newClientsTrend: trend(clientsDelta),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

function nextMonth(d: Date): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return firstOfMonth(next);
}
