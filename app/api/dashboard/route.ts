import { NextResponse } from "next/server";
import { getDb, ensureLocalReady } from "@/lib/db";

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
    const db = getDb();

    const now = new Date();
    const thisMonthStart = firstOfMonth(now);
    const prevMonthStart = firstOfPrevMonth(now);

    // Portfolio hodnota (aktivní nemovitosti).
    const portfolioValue = (db.prepare(
      `SELECT COALESCE(SUM(price), 0) AS s FROM properties WHERE status = 'aktivní'`
    ).get() as Sum).s ?? 0;

    // Aktivní nemovitosti.
    const activeProperties = (db.prepare(
      `SELECT COUNT(*) AS c FROM properties WHERE status = 'aktivní'`
    ).get() as Count).c;

    // Otevřené leady (status != 'uzavřen').
    const openLeads = (db.prepare(
      `SELECT COUNT(*) AS c FROM leads WHERE status != 'uzavřen'`
    ).get() as Count).c;

    // Konverzní poměr (uzavřené / celkové).
    const totalLeads = (db.prepare(
      `SELECT COUNT(*) AS c FROM leads`
    ).get() as Count).c;
    const closedLeads = (db.prepare(
      `SELECT COUNT(*) AS c FROM leads WHERE status = 'uzavřen'`
    ).get() as Count).c;
    const conversionRate = totalLeads > 0
      ? Math.round((closedLeads / totalLeads) * 1000) / 10
      : 0;

    // Tržby aktuální měsíc.
    const monthlyRevenue = (db.prepare(
      `SELECT COALESCE(SUM(sale_price), 0) AS s FROM transactions
       WHERE transaction_date >= ? AND transaction_date < ?`
    ).get(thisMonthStart, nextMonth(now)) as Sum).s ?? 0;

    // Tržby minulý měsíc (pro trend).
    const prevMonthlyRevenue = (db.prepare(
      `SELECT COALESCE(SUM(sale_price), 0) AS s FROM transactions
       WHERE transaction_date >= ? AND transaction_date < ?`
    ).get(prevMonthStart, thisMonthStart) as Sum).s ?? 0;

    // Noví klienti aktuální měsíc.
    const newClients = (db.prepare(
      `SELECT COUNT(*) AS c FROM clients
       WHERE created_at >= ? AND created_at < ?`
    ).get(thisMonthStart, nextMonth(now)) as Count).c;

    const prevNewClients = (db.prepare(
      `SELECT COUNT(*) AS c FROM clients
       WHERE created_at >= ? AND created_at < ?`
    ).get(prevMonthStart, thisMonthStart) as Count).c;

    // Minulý měsíc srovnání pro portfolio/leady — schéma snapshot neexistuje,
    // takže použijeme heuristiku na základě properties.created_at a leads.created_at.
    const prevActiveProperties = (db.prepare(
      `SELECT COUNT(*) AS c FROM properties
       WHERE status = 'aktivní' AND created_at < ?`
    ).get(thisMonthStart) as Count).c;

    const prevOpenLeads = (db.prepare(
      `SELECT COUNT(*) AS c FROM leads
       WHERE status != 'uzavřen' AND created_at < ?`
    ).get(thisMonthStart) as Count).c;

    const prevPortfolioValue = (db.prepare(
      `SELECT COALESCE(SUM(price), 0) AS s FROM properties
       WHERE status = 'aktivní' AND created_at < ?`
    ).get(thisMonthStart) as Sum).s ?? 0;

    const prevClosedLeads = (db.prepare(
      `SELECT COUNT(*) AS c FROM leads
       WHERE status = 'uzavřen' AND created_at < ?`
    ).get(thisMonthStart) as Count).c;
    const prevTotalLeads = (db.prepare(
      `SELECT COUNT(*) AS c FROM leads WHERE created_at < ?`
    ).get(thisMonthStart) as Count).c;
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
