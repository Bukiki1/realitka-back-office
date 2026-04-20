"use client";

export type QuickAction = {
  title: string;
  subtitle: string;
  prompt: string;
  icon: React.ReactNode;
};

const ICON_PROPS = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none" } as const;

export const QUICK_ACTIONS: QuickAction[] = [
  {
    title: "Follow-upy",
    subtitle: "Klienti bez kontaktu 3+ dní · priorita",
    prompt:
      "Ukaž follow-upy — klienty, které jsme dlouho nekontaktovali. Rozděl je podle priority (14+ dní, 7–14, 3–7) a na konci doporuč, koho kontaktovat jako prvního.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 2a10 10 0 1 0 10 10M22 2L12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    ),
  },
  {
    title: "Pipeline",
    subtitle: "Kanban 5 fází + provize + predikce",
    prompt:
      "Ukaž pipeline leadů podle fází. U každé fáze uveď potenciální provizi, realizovanou provizi za tento měsíc a predikci z fáze nabídka. Pod funnel přidej 2–3 věty komentáře.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Nové nabídky",
    subtitle: "Sreality, Bezrealitky, IdealBydlení",
    prompt:
      "Zkontroluj nové nabídky na trhu v Praze Holešovicích a ukaž je jako karty s cenou a odkazem. Na konci shrň průměrnou cenu, cenové rozpětí a doporučení.",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
        <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    title: "Týdenní report",
    subtitle: "Executive summary, KPI a 3 slidy",
    prompt:
      "Připrav mi týdenní manažerský report s KPI, trendy a doporučeními. Potřebuju i 3 slidy (Přehled, Trendy, Doporučení) v chatu.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 4h16v12H4z M8 20h8 M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 12l2-3 2 2 3-4 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Spáruj klienty",
    subtitle: "Klient ↔ nemovitost · skóre shody",
    prompt:
      "Spáruj klienty s aktivními nemovitostmi podle preferencí a ukaž 8 nejvhodnějších párů. U každého uveď skóre shody (lokalita, rozpočet, pokoje, typ) a tlačítko pro oslovovací email.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M10 13a5 5 0 0 1 7-7l1 1a5 5 0 0 1-7 7M14 11a5 5 0 0 1-7 7l-1-1a5 5 0 0 1 7-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Cenová mapa",
    subtitle: "Průměrné ceny podle lokalit · bar chart",
    prompt:
      "Ukaž cenovou mapu — průměrné ceny za m² po městech a okresech. Pod grafem shrň, kde jsou nejvyšší a nejnižší ceny a kam směřovat akvizici.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z M9 3v15 M15 6v15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Chybějící data",
    subtitle: "Audit kompletnosti rekonstrukcí a úprav",
    prompt:
      "Zavolej nástroj find_missing_data (field=any) a vypiš konkrétní seznam prvních 20 nemovitostí s chybějícími daty jako markdown tabulku se sloupci: adresa, město, cena, co chybí. Nevracej jen souhrnné číslo — vypiš všechny položky, které nástroj vrátil. Na konci přidej krátké shrnutí (kolik celkem chybí v celé databázi) a doporuč další kroky.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 9v4M12 17h.01M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    title: "Doporučení",
    subtitle: "Stale leady, drahé byty, prioritní akce",
    prompt:
      "Co mám dnes dělat jako první? Projdi leady bez kontaktu přes 7 dní, nemovitosti aktivní přes 45 dní a prioritní obchody k uzavření. Seřaď podle priority.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 2l2.5 6.5L21 10l-5 4.5L17.5 22 12 18.5 6.5 22 8 14.5 3 10l6.5-1.5L12 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    ),
  },
];

export function QuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {QUICK_ACTIONS.map((a) => (
        <button
          key={a.title}
          onClick={() => onPick(a.prompt)}
          className="group text-left rounded-xl border border-border bg-bg-panel p-4 transition hover:border-accent hover:bg-bg-hover shadow-soft"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 grid place-items-center rounded-lg bg-accent-soft p-2 text-accent group-hover:bg-accent group-hover:text-white transition">
              {a.icon}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{a.title}</div>
              <div className="mt-0.5 text-xs text-text-muted line-clamp-2">{a.subtitle}</div>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
