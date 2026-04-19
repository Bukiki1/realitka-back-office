import { AUTO_MODEL_ID } from "./models";

export type Agent = {
  id: string;
  name: string;
  icon: string;        // emoji
  color: string;       // hex
  systemPrompt: string;
  preferredModel: string; // model id nebo "auto"
  allowedTools: string[]; // podmnožina TOOL_DEFINITIONS.name
  builtIn?: boolean;
};

export const ALL_TOOL_NAMES = [
  "query_database",
  "generate_chart",
  "find_missing_data",
  "generate_report",
  "search_properties",
  "draft_email",
  "generate_weekly_report",
  "monitor_listings",
  "send_email",
  "view_pipeline",
  "compare_properties",
  "get_recommendations",
  "price_map",
  "check_followups",
  "match_clients_properties",
  "client_briefing",
  "price_context",
  "add_client",
  "update_client",
  "delete_client",
  "add_property",
  "update_property",
  "delete_property",
  "add_lead",
  "update_lead",
  "delete_lead",
  "add_transaction",
  "import_csv",
] as const;

export const TOOL_LABELS: Record<string, string> = {
  query_database: "Databáze (SQL)",
  generate_chart: "Grafy",
  find_missing_data: "Chybějící data",
  generate_report: "Reporty",
  search_properties: "Hledání nemovitostí",
  draft_email: "Email klientovi",
  generate_weekly_report: "Týdenní report + slidy",
  monitor_listings: "Monitoring inzerátů",
  send_email: "Odeslat email",
  view_pipeline: "Pipeline leadů",
  compare_properties: "Porovnání nemovitostí",
  get_recommendations: "Doporučení",
  price_map: "Cenová mapa",
  check_followups: "Follow-upy",
  match_clients_properties: "Párování klientů",
  client_briefing: "Briefing klienta",
  price_context: "Cenový kontext",
  add_client: "Přidat klienta",
  update_client: "Upravit klienta",
  delete_client: "Smazat klienta",
  add_property: "Přidat nemovitost",
  update_property: "Upravit nemovitost",
  delete_property: "Smazat nemovitost",
  add_lead: "Přidat lead",
  update_lead: "Upravit lead",
  delete_lead: "Smazat lead",
  add_transaction: "Zapsat transakci",
  import_csv: "Import CSV",
};

export const EMOJI_PALETTE = [
  "📊","🏠","📧","📋","🤖","💼","🎯","📈","🔍","💡",
  "🧠","⚡","🎨","📝","🛠️","💰","🔔","📦","🗂️","🎓",
];

export const COLOR_PALETTE = [
  "#2563eb","#10b981","#d97706","#dc2626","#8b5cf6",
  "#ec4899","#0ea5e9","#14b8a6","#f59e0b","#6366f1",
];

export const PRESET_AGENTS: Agent[] = [
  {
    id: "preset-analytik",
    name: "Analytik",
    icon: "📊",
    color: "#2563eb",
    systemPrompt: `Jsi senior datový analytik české realitní firmy Realitka. Tvoje specializace je analýza trhu s nemovitostmi, klientského portfolia a obchodních výsledků.

Pravidla:
- Vždy začni odpověď přehlednou tabulkou s klíčovými čísly
- Ke každé analýze přidej graf pokud je to relevantní
- Na konci každé analýzy uveď 2-3 konkrétní doporučení co s výsledky dělat
- Používej české formátování čísel (mezera jako oddělovač tisíců, čárka pro desetinná místa)
- Ceny uvádej v CZK s označením Kč
- Při porovnávání období vždy uveď procentuální změnu
- Pokud data ukazují anomálii nebo zajímavý trend, upozorni na to
- Odpovídej strukturovaně: shrnutí → detailní data → graf → doporučení`,
    preferredModel: AUTO_MODEL_ID,
    allowedTools: [],
    builtIn: true,
  },
  {
    id: "preset-spravce",
    name: "Správce nemovitostí",
    icon: "🏠",
    color: "#10b981",
    systemPrompt: `Jsi správce portfolia nemovitostí české realitní firmy Realitka. Máš na starosti evidenci nemovitostí, kontrolu kompletnosti dat a koordinaci údržby.

Pravidla:
- Při hledání chybějících dat vždy uveď konkrétní seznam nemovitostí s adresou a ID
- U každé nemovitosti s chybějícími daty navrhni prioritu doplnění (vysoká/střední/nízká) podle hodnoty nemovitosti
- Při vyhledávání nemovitostí zobrazuj přehledné karty s klíčovými parametry (adresa, cena, plocha, počet pokojů, stav)
- Sleduj stav nemovitostí — aktivní, rezervované, prodané — a upozorňuj na nemovitosti které jsou aktivní příliš dlouho
- Formátuj ceny v CZK, plochu v m²
- U každého seznamu uveď celkovou hodnotu portfolia
- Navrhuj konkrétní další kroky: koho kontaktovat, co doplnit, jaké dokumenty vyžádat`,
    preferredModel: AUTO_MODEL_ID,
    allowedTools: [],
    builtIn: true,
  },
  {
    id: "preset-obchodni",
    name: "Obchodní asistent",
    icon: "📧",
    color: "#d97706",
    systemPrompt: `Jsi zkušený obchodní asistent české realitní firmy Realitka. Pomáháš obchodníkům s komunikací s klienty, přípravou podkladů a organizací schůzek.

Pravidla:
- Emaily piš profesionálně ale přátelsky, v češtině, s oslovením klienta jménem
- Při navrhování termínů schůzek nabízej 2-3 konkrétní možnosti v pracovních hodinách (Po-Pá 9:00-17:00)
- Ke každému klientovi uveď kontext z databáze — jakou nemovitost hledá, odkud přišel, v jakém je stavu
- Při přípravě podkladů pro jednání shrň historii komunikace s klientem a jeho požadavky
- Navrhuj vhodné nemovitosti z portfolia na základě preferencí klienta
- U emailů vždy navrhni předmět zprávy
- Odpovědi strukturuj: kontext klienta → návrh akce → připravený text/email`,
    preferredModel: AUTO_MODEL_ID,
    allowedTools: [],
    builtIn: true,
  },
  {
    id: "preset-reporter",
    name: "Reportér",
    icon: "📋",
    color: "#8b5cf6",
    systemPrompt: `Jsi specialista na manažerské reporty a prezentace pro vedení české realitní firmy Realitka. Připravuješ stručné ale výstižné shrnutí obchodních výsledků.

Pravidla:
- Reporty začínaj executive summary — 3 věty shrnující nejdůležitější zjištění
- Klíčové metriky zobrazuj jako KPI karty: hodnota, změna oproti minulému období, trend (↑↓→)
- Vždy uveď: počet nových klientů, počet leadů, počet uzavřených obchodů, celkový objem transakcí, průměrná provize
- Data vizualizuj grafy — čárový pro trendy, koláčový pro podíly, sloupcový pro porovnání
- Na konci reportu uveď sekci Doporučení pro vedení s 3-5 konkrétními akcemi
- Formát reportu: Executive summary → KPI přehled → Detailní analýza → Grafy → Doporučení
- Prezentace strukturuj na 3 slidy: Přehled výsledků, Klíčové trendy, Doporučení a výhled`,
    preferredModel: AUTO_MODEL_ID,
    allowedTools: [],
    builtIn: true,
  },
];

const AGENTS_KEY = "agents_v1";
const ACTIVE_AGENT_KEY = "active_agent_id";

export function loadAgents(): Agent[] {
  if (typeof window === "undefined") return PRESET_AGENTS;
  const raw = localStorage.getItem(AGENTS_KEY);
  if (!raw) {
    localStorage.setItem(AGENTS_KEY, JSON.stringify(PRESET_AGENTS));
    return PRESET_AGENTS;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return PRESET_AGENTS;
    // Migrace: refreshni systemPrompt a allowedTools u zabudovaných presetů
    // (builtIn=true), aby pozdější úpravy v kódu automaticky doputovaly k uživateli.
    // Uživatelem vytvořených ani smazaných presetů se migrace netýká.
    let changed = false;
    const byPresetId = new Map(PRESET_AGENTS.map((p) => [p.id, p]));
    const merged: Agent[] = (parsed as Agent[]).map((a) => {
      const preset = a.builtIn ? byPresetId.get(a.id) : undefined;
      if (!preset) return a;
      const sameTools =
        a.allowedTools.length === preset.allowedTools.length &&
        a.allowedTools.every((t, i) => t === preset.allowedTools[i]);
      if (a.systemPrompt === preset.systemPrompt && sameTools) return a;
      changed = true;
      return { ...a, systemPrompt: preset.systemPrompt, allowedTools: preset.allowedTools };
    });
    if (changed) localStorage.setItem(AGENTS_KEY, JSON.stringify(merged));
    return merged;
  } catch {}
  return PRESET_AGENTS;
}

export function saveAgents(agents: Agent[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
}

export function findAgent(agents: Agent[], id: string | null): Agent | null {
  if (!id) return null;
  return agents.find((a) => a.id === id) ?? null;
}

export function loadActiveAgentId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(ACTIVE_AGENT_KEY);
}

export function saveActiveAgentId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_AGENT_KEY, id);
  else localStorage.removeItem(ACTIVE_AGENT_KEY);
}

export function newAgentId(): string {
  return "agent_" + Math.random().toString(36).slice(2, 10);
}
