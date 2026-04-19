"use client";

import { useEffect, useState } from "react";

type Trend = "up" | "down" | "flat";

type DashboardData = {
  portfolioValue: number;
  portfolioValueDelta: number;
  portfolioValueTrend: Trend;
  activeProperties: number;
  activePropertiesDelta: number;
  activePropertiesTrend: Trend;
  openLeads: number;
  openLeadsDelta: number;
  openLeadsTrend: Trend;
  conversionRate: number;
  conversionRateDelta: number;
  conversionRateTrend: Trend;
  monthlyRevenue: number;
  monthlyRevenueDelta: number;
  monthlyRevenueTrend: Trend;
  newClients: number;
  newClientsDelta: number;
  newClientsTrend: Trend;
};

function czNum(n: number): string {
  return n.toLocaleString("cs-CZ");
}

function formatMillions(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m.toFixed(m >= 10 ? 0 : 1).replace(".", ",")} mil. Kč`;
  }
  return `${czNum(n)} Kč`;
}

function formatThousands(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m.toFixed(m >= 10 ? 0 : 2).replace(".", ",")} mil. Kč`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${k.toFixed(0)} tis. Kč`;
  }
  return `${czNum(n)} Kč`;
}

function TrendBadge({ trend, delta, suffix = "%" }: { trend: Trend; delta: number; suffix?: string }) {
  const arrow = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const color = trend === "up" ? "#10b981" : trend === "down" ? "#ef4444" : "#9ca3af";
  const sign = delta > 0 ? "+" : "";
  return (
    <span className="rk-kpi-trend" style={{ color }}>
      <span>{arrow}</span>
      <span>{sign}{delta}{suffix}</span>
      <span className="rk-kpi-trend-note">vs. min. měsíc</span>
    </span>
  );
}

function IconPortfolio() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21V13h6v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconProperties() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V11z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function IconLeads() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconConversion() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M3 3v18h18M7 15l4-4 3 3 5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconRevenue() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 1v22M17 5H9.5a3.5 3.5 0 1 0 0 7h5a3.5 3.5 0 1 1 0 7H6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconNewClients() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.error) setError(String(j.error));
        else setData(j as DashboardData);
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <div className="rk-dash-error">
        Dashboard nelze načíst: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rk-dashboard">
        <div className="rk-dash-grid-big">
          {[0, 1, 2, 3].map((i) => <div key={i} className="rk-kpi-card rk-kpi-skeleton" />)}
        </div>
        <div className="rk-dash-grid-small">
          {[0, 1].map((i) => <div key={i} className="rk-kpi-card rk-kpi-small rk-kpi-skeleton" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="rk-dashboard">
      <div className="rk-dash-heading">Přehled portfolia</div>
      <div className="rk-dash-grid-big">
        <div className="rk-kpi-card">
          <div className="rk-kpi-top">
            <span className="rk-kpi-icon" style={{ color: "#2563eb" }}><IconPortfolio /></span>
            <span className="rk-kpi-name">Hodnota portfolia</span>
          </div>
          <div className="rk-kpi-value">{formatMillions(data.portfolioValue)}</div>
          <TrendBadge trend={data.portfolioValueTrend} delta={data.portfolioValueDelta} />
        </div>
        <div className="rk-kpi-card">
          <div className="rk-kpi-top">
            <span className="rk-kpi-icon" style={{ color: "#10b981" }}><IconProperties /></span>
            <span className="rk-kpi-name">Aktivní nemovitosti</span>
          </div>
          <div className="rk-kpi-value">{czNum(data.activeProperties)}</div>
          <TrendBadge trend={data.activePropertiesTrend} delta={data.activePropertiesDelta} />
        </div>
        <div className="rk-kpi-card">
          <div className="rk-kpi-top">
            <span className="rk-kpi-icon" style={{ color: "#f59e0b" }}><IconLeads /></span>
            <span className="rk-kpi-name">Otevřené leady</span>
          </div>
          <div className="rk-kpi-value">{czNum(data.openLeads)}</div>
          <TrendBadge trend={data.openLeadsTrend} delta={data.openLeadsDelta} />
        </div>
        <div className="rk-kpi-card">
          <div className="rk-kpi-top">
            <span className="rk-kpi-icon" style={{ color: "#6366f1" }}><IconConversion /></span>
            <span className="rk-kpi-name">Konverzní poměr</span>
          </div>
          <div className="rk-kpi-value">{data.conversionRate.toFixed(1).replace(".", ",")}%</div>
          <TrendBadge trend={data.conversionRateTrend} delta={data.conversionRateDelta} suffix=" p.b." />
        </div>
      </div>

      <div className="rk-dash-grid-small">
        <div className="rk-kpi-card rk-kpi-small">
          <div className="rk-kpi-top">
            <span className="rk-kpi-icon" style={{ color: "#ec4899" }}><IconRevenue /></span>
            <span className="rk-kpi-name">Tržby tento měsíc</span>
          </div>
          <div className="rk-kpi-value">{formatThousands(data.monthlyRevenue)}</div>
          <TrendBadge trend={data.monthlyRevenueTrend} delta={data.monthlyRevenueDelta} />
        </div>
        <div className="rk-kpi-card rk-kpi-small">
          <div className="rk-kpi-top">
            <span className="rk-kpi-icon" style={{ color: "#14b8a6" }}><IconNewClients /></span>
            <span className="rk-kpi-name">Noví klienti tento měsíc</span>
          </div>
          <div className="rk-kpi-value">{czNum(data.newClients)}</div>
          <TrendBadge trend={data.newClientsTrend} delta={data.newClientsDelta} />
        </div>
      </div>
    </div>
  );
}
