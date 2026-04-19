"use client";

import { useCallback, useEffect, useState } from "react";

type Followup = {
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

type Summary = {
  urgent_count: number;
  important_count: number;
  watch_count: number;
  missing_data_count: number;
  todays_tasks_count: number;
  tomorrows_tasks_count: number;
  opportunities_count: number;
  threatened_commission: number;
  realized_commission: number;
  realized_deals: number;
  pipeline_commission: number;
  pipeline_deals: number;
};

type BriefingData = {
  anyUrgent: boolean;
  summary: Summary;
  followups: Followup[];
  missingData: MissingData[];
  todaysTasks: CalendarItem[];
  tomorrowsPreview: CalendarItem[];
  opportunities: Opportunity[];
};

function czMoney(n: number): string {
  if (!Number.isFinite(n)) return "0 Kč";
  return new Intl.NumberFormat("cs-CZ").format(Math.round(n)) + " Kč";
}

function priorityOf(days: number): "red" | "yellow" | "green" {
  if (days >= 14) return "red";
  if (days >= 7) return "yellow";
  return "green";
}

const PRIO_META: Record<"red" | "yellow" | "green", { label: string; color: string; bg: string }> = {
  red:    { label: "URGENTNÍ",  color: "#ef4444", bg: "rgba(127,29,29,0.18)" },
  yellow: { label: "DŮLEŽITÉ",  color: "#f59e0b", bg: "rgba(120,53,15,0.18)" },
  green:  { label: "SLEDOVAT",  color: "#10b981", bg: "rgba(20,83,45,0.18)" },
};

export function MorningBriefing() {
  const [data, setData] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    fetch("/api/briefing")
      .then((r) => r.json())
      .then((d) => {
        if (aborted) return;
        if (d?.error) setError(String(d.error));
        else setData(d as BriefingData);
      })
      .catch((e) => !aborted && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !aborted && setLoading(false));
    return () => { aborted = true; };
  }, []);

  const fillInput = useCallback((text: string) => {
    window.dispatchEvent(new CustomEvent("rk:fill-input", { detail: { text } }));
  }, []);

  const openClient = useCallback((id: number) => {
    window.dispatchEvent(new CustomEvent("rk:open-client", { detail: { id } }));
  }, []);

  const fmtHHMM = (iso: string) => {
    const m = iso.match(/(\d{2}):(\d{2})/);
    return m ? `${m[1]}:${m[2]}` : iso;
  };
  const typeIcon = (t: string) =>
    t === "prohlídka" ? "🏠" : t === "meeting" ? "🤝" : t === "hovor" ? "📞" : "📌";
  const dateLabel = (iso: string) => {
    const d = new Date(iso.replace(" ", "T"));
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });
  };

  if (loading) {
    return (
      <div className="rk-briefing rk-briefing-loading">
        <div className="rk-briefing-skeleton" />
        <div className="rk-briefing-skeleton" />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const { summary, followups, missingData, todaysTasks, tomorrowsPreview, opportunities } = data;

  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 10 ? "Dobré ráno" : hour < 18 ? "Dobrý den" : "Dobrý večer";
  const dateStr = now.toLocaleDateString("cs-CZ", { weekday: "long", day: "numeric", month: "long" });

  const allOk = summary.urgent_count === 0 && summary.missing_data_count === 0 && summary.todays_tasks_count === 0;

  return (
    <div className="rk-briefing">
      <button
        type="button"
        className="rk-briefing-head"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <div className="rk-briefing-head-main">
          <span className="rk-briefing-sun">{hour < 18 ? "☀️" : "🌙"}</span>
          <div className="rk-briefing-title">
            <div className="rk-briefing-greet">{greet} — tady je váš denní přehled</div>
            <div className="rk-briefing-date">{dateStr}</div>
          </div>
        </div>
        <div className="rk-briefing-chips">
          {summary.urgent_count > 0 && (
            <span className="rk-briefing-chip" style={{ color: "#ef4444", borderColor: "#7f1d1d" }}>
              🔴 {summary.urgent_count} urgentních
            </span>
          )}
          {summary.important_count > 0 && (
            <span className="rk-briefing-chip" style={{ color: "#f59e0b", borderColor: "#78350f" }}>
              🟡 {summary.important_count} důležitých
            </span>
          )}
          {summary.todays_tasks_count > 0 && (
            <span className="rk-briefing-chip" style={{ color: "#6366f1", borderColor: "#312e81" }}>
              📅 {summary.todays_tasks_count} dnes
            </span>
          )}
          {summary.opportunities_count > 0 && (
            <span className="rk-briefing-chip" style={{ color: "#10b981", borderColor: "#14532d" }}>
              💡 {summary.opportunities_count} příležitostí
            </span>
          )}
          <span className="rk-briefing-toggle">{collapsed ? "▼ Rozbalit" : "▲ Sbalit"}</span>
        </div>
      </button>

      {!collapsed && (
        <div className="rk-briefing-body">
          {allOk && (
            <div className="rk-briefing-ok">✅ Vše v pořádku — žádné urgentní úkoly.</div>
          )}

          {followups.length > 0 && (
            <section className="rk-briefing-section">
              <h3 className="rk-briefing-h">
                🔥 Urgentní follow-upy
                <span className="rk-briefing-h-sub">
                  ohrožená provize: <strong>{czMoney(summary.threatened_commission)}</strong>
                </span>
              </h3>
              <div className="rk-briefing-list">
                {followups.slice(0, 6).map((f) => {
                  const prio = priorityOf(f.days_since);
                  const meta = PRIO_META[prio];
                  return (
                    <div
                      key={f.lead_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openClient(f.client_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openClient(f.client_id);
                        }
                      }}
                      className={`rk-followup rk-followup-${prio} rk-client-card`}
                      style={{ borderLeftColor: meta.color, background: meta.bg }}
                      title="Klikněte pro detail klienta"
                    >
                      <div className="rk-followup-top">
                        <div>
                          <div className="rk-followup-name">{f.client_name}</div>
                          <div className="rk-followup-addr">{f.property_addr}</div>
                        </div>
                        <div className="rk-followup-days" style={{ color: meta.color }}>
                          {f.days_since} dní
                        </div>
                      </div>
                      <div className="rk-followup-mid">
                        <span className="rk-followup-status">{f.status}</span>
                        <span className="rk-followup-commission">
                          Provize ~ {czMoney(f.estimated_commission)}
                        </span>
                      </div>
                      <div className="rk-followup-actions" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() =>
                            fillInput(
                              `Napiš follow-up email pro ${f.client_name} ohledně nemovitosti na ${f.property_addr}.`,
                            )
                          }
                        >
                          ✉️ Poslat follow-up email
                        </button>
                        <button
                          type="button"
                          className="rk-followup-btn-secondary"
                          onClick={() =>
                            fillInput(`Připrav briefing na klienta ${f.client_name}`)
                          }
                        >
                          👤 Briefing
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="rk-briefing-section">
            <h3 className="rk-briefing-h">📅 Dnešní úkoly</h3>
            {todaysTasks.length === 0 ? (
              <div className="rk-briefing-empty">Dnes nemáte naplánované žádné schůzky.</div>
            ) : (
              <div className="rk-briefing-list">
                {todaysTasks.map((t) => {
                  const clickable = t.client_id != null;
                  return (
                    <div
                      key={t.id}
                      className={`rk-today-card${clickable ? " rk-client-card" : ""}`}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => openClient(t.client_id!) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openClient(t.client_id!);
                              }
                            }
                          : undefined
                      }
                      title={clickable ? "Klikněte pro detail klienta" : undefined}
                    >
                      <div className="rk-today-head">
                        <div className="rk-today-time">
                          {fmtHHMM(t.start_time)}–{fmtHHMM(t.end_time)}
                        </div>
                        <span className="rk-today-status">
                          {typeIcon(t.type)} {t.type}
                        </span>
                      </div>
                      <div className="rk-today-name">{t.title}</div>
                      <div className="rk-today-meta">
                        {t.client_name && <span>👤 {t.client_name}</span>}
                        {t.property_address && <span>📍 {t.property_address}</span>}
                        {t.location && !t.property_address && <span>📍 {t.location}</span>}
                      </div>
                      {t.notes && <div className="rk-today-notes">🗒 {t.notes}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {tomorrowsPreview.length > 0 && (
            <section className="rk-briefing-section">
              <h3 className="rk-briefing-h">
                📅 Zítra — náhled
                <span className="rk-briefing-h-sub">{dateLabel(tomorrowsPreview[0].start_time)}</span>
              </h3>
              <div className="rk-briefing-list">
                {tomorrowsPreview.map((t) => {
                  const clickable = t.client_id != null;
                  return (
                    <div
                      key={t.id}
                      className={`rk-today-card rk-today-card-preview${clickable ? " rk-client-card" : ""}`}
                      role={clickable ? "button" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => openClient(t.client_id!) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openClient(t.client_id!);
                              }
                            }
                          : undefined
                      }
                      title={clickable ? "Klikněte pro detail klienta" : undefined}
                    >
                      <div className="rk-today-head">
                        <div className="rk-today-time">
                          {fmtHHMM(t.start_time)}–{fmtHHMM(t.end_time)}
                        </div>
                        <span className="rk-today-status">
                          {typeIcon(t.type)} {t.type}
                        </span>
                      </div>
                      <div className="rk-today-name">{t.title}</div>
                      <div className="rk-today-meta">
                        {t.client_name && <span>👤 {t.client_name}</span>}
                        {t.property_address && <span>📍 {t.property_address}</span>}
                        {t.location && !t.property_address && <span>📍 {t.location}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {missingData.length > 0 && (
            <section className="rk-briefing-section">
              <h3 className="rk-briefing-h">
                ⚠️ Nekompletní data
                <span className="rk-briefing-h-sub">{summary.missing_data_count} nemovitostí</span>
              </h3>
              <div className="rk-missing-list">
                {missingData.slice(0, 5).map((m) => (
                  <div key={m.id} className="rk-missing-row">
                    <div>
                      <div className="rk-missing-addr">{m.address}</div>
                      <div className="rk-missing-city">{m.city}</div>
                    </div>
                    <div className="rk-missing-tags">
                      {m.missing.map((x) => (
                        <span key={x} className="rk-missing-tag">chybí: {x}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {opportunities.length > 0 && (
            <section className="rk-briefing-section">
              <h3 className="rk-briefing-h">💡 Nové příležitosti</h3>
              <div className="rk-briefing-list">
                {opportunities.slice(0, 4).map((o) => (
                  <div key={o.client_id} className="rk-opp-card">
                    <div className="rk-opp-name">{o.client_name}</div>
                    <div className="rk-opp-pref">
                      {o.preferred_type ?? "—"} · {o.preferred_locality ?? "—"}
                      {(o.budget_min || o.budget_max) && (
                        <> · {czMoney(o.budget_min ?? 0)}–{czMoney(o.budget_max ?? 0)}</>
                      )}
                    </div>
                    <div className="rk-opp-sugg">{o.suggestion}</div>
                    <button
                      type="button"
                      onClick={() =>
                        fillInput(
                          `Najdi vhodné nemovitosti pro klienta ${o.client_name}`,
                        )
                      }
                    >
                      🔗 Spárovat
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rk-briefing-section rk-briefing-money">
            <h3 className="rk-briefing-h">💰 Provize</h3>
            <div className="rk-money-grid">
              <div className="rk-money-card">
                <div className="rk-money-label">Realizováno tento měsíc</div>
                <div className="rk-money-value" style={{ color: "#10b981" }}>
                  {czMoney(summary.realized_commission)}
                </div>
                <div className="rk-money-sub">{summary.realized_deals} transakcí</div>
              </div>
              <div className="rk-money-card">
                <div className="rk-money-label">V pipeline (fáze „nabídka")</div>
                <div className="rk-money-value" style={{ color: "#ec4899" }}>
                  {czMoney(summary.pipeline_commission)}
                </div>
                <div className="rk-money-sub">{summary.pipeline_deals} leadů</div>
              </div>
              <div className="rk-money-card">
                <div className="rk-money-label">Ohrožená provize</div>
                <div className="rk-money-value" style={{ color: "#ef4444" }}>
                  {czMoney(summary.threatened_commission)}
                </div>
                <div className="rk-money-sub">{followups.length} stale leadů</div>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
