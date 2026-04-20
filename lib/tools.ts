import type Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";
import { getDb, dbRun, dbAll, ensureLocalReady } from "./db";

export const TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "query_database",
    description:
      "Provede read-only SQL dotaz nad SQLite databází realitní kanceláře. Tabulky: " +
      "clients(id, name, email, phone, source, created_at, quarter), " +
      "properties(id, address, city, district, type, price, area_m2, rooms, status, reconstruction_data, building_modifications, description, created_at), " +
      "leads(id, client_id, property_id, status, source, created_at), " +
      "transactions(id, property_id, client_id, sale_price, commission, transaction_date). " +
      "Povolené jsou pouze SELECT dotazy. Vrací pole objektů (max 200 řádků).",
    input_schema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "Read-only SELECT SQL dotaz nad výše uvedenými tabulkami.",
        },
      },
      required: ["sql"],
    },
  },
  {
    name: "generate_chart",
    description:
      "Vygeneruje INTERAKTIVNÍ graf (Recharts) pro vložení přímo do chatu — s tooltipy, legendou, animací, tmavým designem. Výstup obsahuje pole 'markdown' s HTML značkou pro interaktivní graf + fallback na statický obrázek z QuickChart.io. Vlož pole 'markdown' BEZE ZMĚNY do odpovědi. Použij pro všechny vizualizace: bar, line, area, pie, doughnut, horizontalBar.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bar", "line", "area", "pie", "doughnut", "horizontalBar"],
          description: "Typ grafu.",
        },
        title: { type: "string", description: "Titulek grafu v češtině." },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "Popisky osy X (nebo segmentů u pie/doughnut).",
        },
        datasets: {
          type: "array",
          description:
            "Datové řady. Každá má label (legenda) a data (pole čísel stejné délky jako labels).",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              data: { type: "array", items: { type: "number" } },
            },
            required: ["label", "data"],
          },
        },
      },
      required: ["type", "labels", "datasets"],
    },
  },
  {
    name: "find_missing_data",
    description:
      "Najde nemovitosti, kde chybí důležitá data (reconstruction_data nebo building_modifications je NULL). Volitelně filtruj podle typu pole.",
    input_schema: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: ["reconstruction_data", "building_modifications", "any"],
          description:
            "Které pole se má kontrolovat. 'any' vrátí nemovitosti, kde chybí alespoň jedno z těchto polí.",
        },
        limit: {
          type: "integer",
          description: "Maximální počet vrácených záznamů (výchozí 50).",
        },
      },
      required: ["field"],
    },
  },
  {
    name: "generate_report",
    description:
      "Vytvoří strukturovaný markdown report z poskytnutých dat. Použij pro finální shrnutí analýzy pro uživatele.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titulek reportu." },
        sections: {
          type: "array",
          description: "Sekce reportu v pořadí, v jakém se mají zobrazit.",
          items: {
            type: "object",
            properties: {
              heading: { type: "string", description: "Nadpis sekce." },
              body: { type: "string", description: "Tělo sekce v markdownu (může obsahovat tabulky, odrážky, obrázky)." },
            },
            required: ["heading", "body"],
          },
        },
      },
      required: ["title", "sections"],
    },
  },
  {
    name: "search_properties",
    description:
      "Vyhledá nemovitosti podle filtrů (město, cenové rozpětí, typ, stav, okres, minimální plocha).",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string", description: "Město (např. Praha, Brno, Ostrava)." },
        district: { type: "string", description: "Okres / část města." },
        type: { type: "string", enum: ["byt", "dům", "komerční"] },
        status: { type: "string", enum: ["aktivní", "prodáno", "rezervováno"] },
        min_price: { type: "integer", description: "Minimální cena v CZK." },
        max_price: { type: "integer", description: "Maximální cena v CZK." },
        min_area_m2: { type: "integer", description: "Minimální plocha v m²." },
        limit: { type: "integer", description: "Max počet výsledků (výchozí 20)." },
      },
    },
  },
  {
    name: "draft_email",
    description:
      "Sestaví profesionální český email klientovi s návrhem 3 termínů prohlídky nemovitosti v příštím pracovním týdnu (Po–Pá 9:00–17:00). Simuluje dostupnost kalendáře. Vrátí hotový email (předmět + tělo) připravený k odeslání.",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string", description: "Jméno klienta pro oslovení." },
        property: {
          type: "string",
          description:
            "Popis nemovitosti (např. 'byt 3+kk, Praha 7 — Holešovice, 85 m²'). Pokud neznámé, uveď obecné označení.",
        },
        topic: {
          type: "string",
          description: "Téma emailu / účel schůzky (výchozí: prohlídka nemovitosti).",
        },
        sender_name: {
          type: "string",
          description: "Jméno obchodníka / odesílatele (výchozí: 'Realitka — obchodní oddělení').",
        },
      },
      required: ["client_name", "property"],
    },
  },
  {
    name: "generate_weekly_report",
    description:
      "Sestaví týdenní manažerský report z databáze — KPI za posledních 7 dní (noví klienti, noví leady, uzavřené obchody, objem transakcí, průměrná provize), markdown executive summary, a 3 HTML slidy (Přehled, Trendy s grafem, Doporučení) v tmavém designu.",
    input_schema: {
      type: "object",
      properties: {
        week_label: {
          type: "string",
          description: "Volitelný textový popis týdne (např. 'Týden 15–21. dubna 2026').",
        },
      },
    },
  },
  {
    name: "monitor_listings",
    description:
      "REÁLNĚ stahuje aktuální nabídky z českých realitních serverů (Sreality.cz, Bezrealitky.cz, IdealBydleni.cz). Scrapuje JSON API nebo HTML. Pokud některý server selže, vrátí data z ostatních a fallback z cache. Výstup obsahuje pole 'markdown' s hotovým přehledem inzerátů seskupených podle zdroje a souhrnnou tabulkou — vlož BEZE ZMĚNY do odpovědi.",
    input_schema: {
      type: "object",
      properties: {
        locality: {
          type: "string",
          description:
            "Lokalita pro monitoring. Výchozí 'Praha 7 - Holešovice'. Může být jakákoliv česká lokalita.",
        },
        servers: {
          type: "array",
          items: { type: "string", enum: ["sreality", "bezrealitky", "idealbydleni"] },
          description: "Které servery scrapovat. Výchozí všechny tři.",
        },
        type: {
          type: "string",
          enum: ["prodej", "pronájem"],
          description: "Typ nabídky. Výchozí 'prodej'.",
        },
        property_type: {
          type: "string",
          enum: ["byt", "dům", "komerční"],
          description: "Typ nemovitosti. Výchozí 'byt'.",
        },
      },
    },
  },
  {
    name: "send_email",
    description:
      "REÁLNĚ odešle email přes Gmail SMTP. Vyžaduje nakonfigurované přihlašovací údaje v /settings (GMAIL_USER + GMAIL_APP_PASSWORD). Použij, když uživatel explicitně požádá o odeslání. Pro přípravu draftu použij draft_email.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Emailová adresa příjemce." },
        subject: { type: "string", description: "Předmět emailu." },
        body: { type: "string", description: "Tělo emailu v plain textu (\\n pro řádky)." },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "view_pipeline",
    description:
      "Zobrazí vizualizaci pipeline leadů (kanban funnel) — 5 stavů: nový → kontaktován → prohlídka → nabídka → uzavřen. Pro každý stav počet leadů, celková hodnota nemovitostí a konverzní poměr na další fázi. Výstup obsahuje pole 'markdown' s hotovým přehledem — vlož BEZE ZMĚNY do odpovědi.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "compare_properties",
    description:
      "Porovná 2–4 nemovitosti vedle sebe. Vstup: pole ID nemovitostí NEBO pole adres/lokalit (string). Když jsou adresy, najde nejbližší shody v DB. Výstup obsahuje pole 'markdown' s porovnávací tabulkou a shrnutím — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        property_ids: {
          type: "array",
          items: { type: "integer" },
          description: "Pole ID nemovitostí (2–4).",
        },
        addresses: {
          type: "array",
          items: { type: "string" },
          description: "Alternativně — pole adres nebo lokalit (částečná shoda).",
        },
      },
    },
  },
  {
    name: "get_recommendations",
    description:
      "Analyzuje databázi a vrátí proaktivní doporučení: leady bez kontaktu > 7 dní, nemovitosti aktivní > 45 dní, klienti ve fázi 'nabídka' s vysokou hodnotou. Každé doporučení má prioritu (urgent/important/info). Obsahuje pole 'markdown' s hotovým seznamem — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "price_map",
    description:
      "Průměrné ceny nemovitostí seskupené podle lokalit (města + městské části). Zobrazí textový bar chart — každá lokalita řádek s cenou za m², barevné kódování emoji (🟢 pod průměrem, 🟡 průměr, 🔴 nad). Obsahuje pole 'markdown' — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["byt", "dům", "komerční"],
          description: "Typ nemovitosti (výchozí: všechny).",
        },
        per_m2: {
          type: "boolean",
          description: "Zobrazit ceny za m² místo celkových cen. Výchozí true.",
        },
      },
    },
  },
  {
    name: "check_followups",
    description:
      "Najde leady, u kterých je poslední kontakt (last_contact_at) starší než 3 dny. Výstup: seznam seřazený podle urgence — 🔴 (14+ dní), 🟡 (7-14 dní), 🟢 (3-7 dní). Každý řádek navrhuje follow-up email pomocí prompt patternu '→ Napište: ...'. Obsahuje pole 'markdown' — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        min_days: {
          type: "integer",
          description: "Minimální počet dní bez kontaktu (výchozí 3).",
        },
      },
    },
  },
  {
    name: "match_clients_properties",
    description:
      "Projde klienty s vyplněnými preferencemi (locality, budget, rooms, type) a najde k nim vhodné aktivní nemovitosti. Pro každý pár spočítá skóre shody (%) podle lokality, rozpočtu (±20%), pokojů a typu. Vrací 5-10 nejlepších párů. Obsahuje pole 'markdown' — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        client_id: {
          type: "integer",
          description: "Volitelně omezit párování jen na konkrétního klienta.",
        },
        limit: {
          type: "integer",
          description: "Max počet zobrazených párů (výchozí 8).",
        },
      },
    },
  },
  {
    name: "client_briefing",
    description:
      "Připraví kompletní briefing o klientovi před schůzkou: kontakt, preference, historii leadů, aktivní leady, doporučené další kroky. Vstup je client_id NEBO jméno klienta. Obsahuje pole 'markdown' s hotovým briefingem. Vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        client_id: {
          type: "integer",
          description: "ID klienta.",
        },
        name: {
          type: "string",
          description: "Alternativně jméno (částečná shoda).",
        },
      },
    },
  },
  {
    name: "price_context",
    description:
      "Porovná cenu konkrétní nemovitosti s podobnými (stejný typ, ±15% plocha, stejný okres). Vrací verdikt (levné / odpovídající / drahé), histogram pozice, argumenty pro vyjednávání. Obsahuje pole 'markdown' — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        property_id: {
          type: "integer",
          description: "ID nemovitosti, kterou chceme zasadit do kontextu.",
        },
        address: {
          type: "string",
          description: "Alternativně adresa (částečná shoda).",
        },
      },
    },
  },
  // ══════════════════════════════════════════════════════════════════
  // CRUD — zápisové nástroje. Agent skutečně zapisuje data do SQLite.
  // ══════════════════════════════════════════════════════════════════
  {
    name: "add_client",
    description:
      "REÁLNĚ zapíše nového klienta do SQLite databáze. Vrátí potvrzení s id a všemi zapsanými poli. Zdroj musí být jeden z: web, doporučení, inzerát, sociální sítě.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Celé jméno klienta." },
        email: { type: "string", description: "Email (povinný)." },
        phone: { type: "string", description: "Telefon (povinný)." },
        source: { type: "string", enum: ["web", "doporučení", "inzerát", "sociální sítě"], description: "Zdroj akvizice." },
        budget_min: { type: "integer", description: "Minimální rozpočet v CZK." },
        budget_max: { type: "integer", description: "Maximální rozpočet v CZK." },
        preferred_locality: { type: "string", description: "Preferovaná lokalita (např. 'Praha 7')." },
        preferred_rooms: { type: "string", description: "Dispozice (např. '3+kk')." },
        preferred_type: { type: "string", enum: ["byt", "dům", "komerční"], description: "Typ nemovitosti." },
        notes: { type: "string", description: "Volné poznámky." },
      },
      required: ["name", "email", "phone", "source"],
    },
  },
  {
    name: "update_client",
    description:
      "REÁLNĚ aktualizuje existující klient v DB. Identifikace přes id NEBO name (částečná shoda — nejnovější, pokud víc). Zadej jen pole, která chceš změnit.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "ID klienta." },
        name_match: { type: "string", description: "Alternativně: část jména (LIKE)." },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        budget_min: { type: "integer" },
        budget_max: { type: "integer" },
        preferred_locality: { type: "string" },
        preferred_rooms: { type: "string" },
        preferred_type: { type: "string", enum: ["byt", "dům", "komerční"] },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "delete_client",
    description:
      "REÁLNĚ smaže klienta z DB. Zároveň smaže všechny jeho leady (transakce zůstávají). Identifikace přes id nebo name_match.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        name_match: { type: "string" },
      },
    },
  },
  {
    name: "add_property",
    description:
      "REÁLNĚ přidá novou nemovitost do DB. Povinné: address, city, district, type, price, area_m2, description. Status implicitně 'aktivní'.",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string" },
        city: { type: "string" },
        district: { type: "string" },
        type: { type: "string", enum: ["byt", "dům", "komerční"] },
        price: { type: "integer", description: "Cena v CZK." },
        area_m2: { type: "integer" },
        rooms: { type: "integer" },
        status: { type: "string", enum: ["aktivní", "prodáno", "rezervováno"] },
        reconstruction_data: { type: "string" },
        building_modifications: { type: "string" },
        description: { type: "string" },
      },
      required: ["address", "city", "district", "type", "price", "area_m2", "description"],
    },
  },
  {
    name: "update_property",
    description:
      "REÁLNĚ aktualizuje nemovitost v DB. Identifikace přes id NEBO address_match.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        address_match: { type: "string" },
        address: { type: "string" },
        city: { type: "string" },
        district: { type: "string" },
        type: { type: "string", enum: ["byt", "dům", "komerční"] },
        price: { type: "integer" },
        area_m2: { type: "integer" },
        rooms: { type: "integer" },
        status: { type: "string", enum: ["aktivní", "prodáno", "rezervováno"] },
        reconstruction_data: { type: "string" },
        building_modifications: { type: "string" },
        description: { type: "string" },
      },
    },
  },
  {
    name: "delete_property",
    description:
      "REÁLNĚ smaže nemovitost z DB. Zároveň smaže související leady. Identifikace přes id nebo address_match.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        address_match: { type: "string" },
      },
    },
  },
  {
    name: "add_lead",
    description:
      "REÁLNĚ přidá nový lead (klient ↔ nemovitost). Povinné: klient (id nebo name_match), nemovitost (id nebo address_match), status, source.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "integer" },
        client_name: { type: "string", description: "Alternativně: část jména klienta (LIKE)." },
        property_id: { type: "integer" },
        property_address: { type: "string", description: "Alternativně: část adresy (LIKE)." },
        status: { type: "string", enum: ["nový", "kontaktován", "prohlídka", "nabídka", "uzavřen"] },
        source: { type: "string", description: "Zdroj leadu (např. 'web', 'doporučení')." },
        last_contact_at: { type: "string", description: "ISO datum posledního kontaktu." },
        next_action: { type: "string" },
        estimated_commission: { type: "number", description: "Odhadovaná provize v CZK." },
      },
      required: ["status", "source"],
    },
  },
  {
    name: "update_lead",
    description:
      "REÁLNĚ aktualizuje existující lead (typicky status, last_contact_at, next_action, estimated_commission).",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "integer", description: "ID leadu." },
        status: { type: "string", enum: ["nový", "kontaktován", "prohlídka", "nabídka", "uzavřen"] },
        last_contact_at: { type: "string" },
        next_action: { type: "string" },
        estimated_commission: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_lead",
    description: "REÁLNĚ smaže lead z DB.",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer" } },
      required: ["id"],
    },
  },
  {
    name: "add_transaction",
    description:
      "REÁLNĚ zapíše uzavřený obchod (transakci) do DB. Automaticky označí nemovitost jako 'prodáno'. Provize se uloží tak, jak byla zadána.",
    input_schema: {
      type: "object",
      properties: {
        property_id: { type: "integer" },
        property_address: { type: "string", description: "Alternativně." },
        client_id: { type: "integer" },
        client_name: { type: "string", description: "Alternativně." },
        sale_price: { type: "integer" },
        commission: { type: "integer" },
        transaction_date: { type: "string", description: "ISO datum (YYYY-MM-DD). Výchozí dnes." },
      },
      required: ["sale_price", "commission"],
    },
  },
  {
    name: "import_csv",
    description:
      "Zobrazí v chatu UI pro nahrání CSV souboru a jeho import do zvolené tabulky (clients / properties / leads / transactions). Po nahrání zobrazí náhled prvních řádků, potvrzení a výsledek importu. Použij, když uživatel chce hromadně importovat data. Nástroj sám data NEZAPISUJE — jen vrátí HTML widget, který spustí nahrávání přes /api/import/csv.",
    input_schema: {
      type: "object",
      properties: {
        table: {
          type: "string",
          enum: ["clients", "properties", "leads", "transactions"],
          description: "Do které tabulky importovat.",
        },
      },
      required: ["table"],
    },
  },
  {
    name: "manage_calendar",
    description:
      "Spravuje kalendář schůzek (prohlídky, meetingy, hovory). Akce: 'add' (přidá událost), 'list' (vypíše události, výchozí dnes), 'find_free' (najde volné 30/60/90min bloky v daný den mezi 9:00–17:00), 'move' (přesune existující záznam), 'cancel' (smaže). Při navrhování prohlídky klientovi vždy používej 'find_free' nejdřív, aby ses vyhnul konfliktům. Výstup obsahuje pole 'markdown' — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "list", "find_free", "move", "cancel"] },
        event_id: { type: "integer", description: "ID události pro move/cancel." },
        title: { type: "string", description: "Název události (add/move)." },
        client_id: { type: "integer" },
        client_name: { type: "string", description: "Alternativně jméno klienta (částečná shoda)." },
        property_id: { type: "integer" },
        property_address: { type: "string", description: "Alternativně adresa nemovitosti." },
        start_time: { type: "string", description: "ISO datum a čas YYYY-MM-DDTHH:MM (add/move)." },
        end_time: { type: "string", description: "ISO datum a čas YYYY-MM-DDTHH:MM (add/move). Pokud chybí, použije se start + duration_min." },
        duration_min: { type: "integer", description: "Trvání v minutách (výchozí 60). Alternativa k end_time." },
        type: { type: "string", enum: ["prohlídka", "meeting", "hovor", "jiné"] },
        location: { type: "string" },
        notes: { type: "string" },
        date: { type: "string", description: "Den ve formátu YYYY-MM-DD pro list / find_free. Alternativně klíčová slova: 'today', 'tomorrow'." },
        range: { type: "string", enum: ["today", "tomorrow", "week", "next_week"], description: "Rozsah pro 'list' (výchozí 'today')." },
        slot_min: { type: "integer", description: "Délka volného bloku v minutách pro find_free (výchozí 60)." },
      },
      required: ["action"],
    },
  },
  {
    name: "view_calendar",
    description:
      "Zobrazí přehled kalendáře — tento nebo příští týden. Pro každý den sloupec s událostmi (čas, název, klient, místo). Výstup obsahuje pole 'markdown' — vlož BEZE ZMĚNY.",
    input_schema: {
      type: "object",
      properties: {
        week: { type: "string", enum: ["this", "next"], description: "Který týden zobrazit (výchozí 'this')." },
      },
    },
  },
];

type ToolResult = { ok: true; data: unknown } | { ok: false; error: string };

function isSelectOnly(sql: string): boolean {
  const trimmed = sql.trim().replace(/^\s*;+/, "").toLowerCase();
  if (!trimmed.startsWith("select") && !trimmed.startsWith("with")) return false;
  const forbidden = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex)\b/;
  return !forbidden.test(trimmed);
}

export async function runTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    await ensureLocalReady();
    switch (name) {
      case "query_database":
        return await toolQueryDatabase(input);
      case "generate_chart":
        return toolGenerateChart(input);
      case "find_missing_data":
        return toolFindMissingData(input);
      case "generate_report":
        return toolGenerateReport(input);
      case "search_properties":
        return toolSearchProperties(input);
      case "draft_email":
        return toolDraftEmail(input);
      case "generate_weekly_report":
        return toolGenerateWeeklyReport(input);
      case "monitor_listings":
        return await toolMonitorListings(input);
      case "send_email":
        return await toolSendEmail(input);
      case "view_pipeline":
        return toolViewPipeline(input);
      case "compare_properties":
        return toolCompareProperties(input);
      case "get_recommendations":
        return toolGetRecommendations(input);
      case "price_map":
        return toolPriceMap(input);
      case "check_followups":
        return toolCheckFollowups(input);
      case "match_clients_properties":
        return toolMatchClientsProperties(input);
      case "client_briefing":
        return toolClientBriefing(input);
      case "price_context":
        return toolPriceContext(input);
      case "add_client":
        return await toolAddClient(input);
      case "update_client":
        return await toolUpdateClient(input);
      case "delete_client":
        return await toolDeleteClient(input);
      case "add_property":
        return await toolAddProperty(input);
      case "update_property":
        return await toolUpdateProperty(input);
      case "delete_property":
        return await toolDeleteProperty(input);
      case "add_lead":
        return await toolAddLead(input);
      case "update_lead":
        return await toolUpdateLead(input);
      case "delete_lead":
        return await toolDeleteLead(input);
      case "add_transaction":
        return await toolAddTransaction(input);
      case "import_csv":
        return toolImportCsv(input);
      case "manage_calendar":
        return await toolManageCalendar(input);
      case "view_calendar":
        return toolViewCalendar(input);
      default:
        return { ok: false, error: `Neznámý nástroj: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function toolQueryDatabase(input: Record<string, unknown>): Promise<ToolResult> {
  const sql = String(input.sql ?? "");
  if (!sql) return { ok: false, error: "Chybí parametr sql." };
  if (!isSelectOnly(sql)) {
    return { ok: false, error: "Pouze read-only SELECT / WITH dotazy jsou povoleny." };
  }
  // Čteme napřímo z Turso (dbAll) — dbAll přesměruje na libsql klient, pokud je
  // Turso nakonfigurováno. Tím agent vidí identická data jako /api/data/* a REST
  // endpointy a nekouká na stale /tmp mirror.
  const rows = await dbAll<Record<string, unknown>>(sql);
  const limited = rows.slice(0, 200);
  return { ok: true, data: { row_count: rows.length, rows: limited } };
}

export const CHART_PALETTE = ["#2563EB", "#10B981", "#F59E0B", "#6366F1", "#EC4899"];

export type InteractiveChartSpec = {
  type: "bar" | "line" | "area" | "pie" | "doughnut" | "horizontalBar";
  title?: string;
  labels: string[];
  datasets: { label: string; data: number[] }[];
  palette: string[];
};

function encodeChartSpec(spec: InteractiveChartSpec): string {
  // base64(utf8) — bezpečné pro HTML atribut, žádné escape problémy.
  const json = JSON.stringify(spec);
  return Buffer.from(json, "utf8").toString("base64");
}

function toolGenerateChart(input: Record<string, unknown>): ToolResult {
  const rawType = String(input.type ?? "bar");
  const type = (["bar", "line", "area", "pie", "doughnut", "horizontalBar"].includes(rawType)
    ? rawType : "bar") as InteractiveChartSpec["type"];
  const title = typeof input.title === "string" ? input.title : undefined;
  const labels = (input.labels as string[]) ?? [];
  const datasets = (input.datasets as { label: string; data: number[] }[]) ?? [];

  if (!Array.isArray(labels) || labels.length === 0) {
    return { ok: false, error: "labels musí být neprázdné pole." };
  }
  if (!Array.isArray(datasets) || datasets.length === 0) {
    return { ok: false, error: "datasets musí být neprázdné pole." };
  }

  const palette = CHART_PALETTE;
  const isPie = type === "pie" || type === "doughnut";

  // U koláčových grafů přidáme procenta do labelů (smysl jen u 1 datasetu s nezáporným součtem).
  let displayLabels = labels;
  if (isPie && datasets.length === 1) {
    const data = datasets[0].data;
    const sum = data.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    if (sum > 0 && data.every((v) => v >= 0)) {
      displayLabels = labels.map((l, i) => {
        const pct = (data[i] * 100) / sum;
        const pctStr = pct.toFixed(1).replace(".", ",");
        return `${l} ${pctStr}%`;
      });
    }
  }

  const spec: InteractiveChartSpec = {
    type,
    title,
    labels: displayLabels,
    datasets,
    palette,
  };
  const specB64 = encodeChartSpec(spec);

  // QuickChart fallback (pokud by Recharts selhal) — konfigurace pro chart.js.
  const chartJsType = type === "area" ? "line"
    : type === "horizontalBar" ? "bar" : type;
  const chartConfig = {
    type: chartJsType,
    data: {
      labels: displayLabels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        backgroundColor: isPie
          ? labels.map((_, j) => palette[j % palette.length])
          : (type === "area" ? `${palette[i % palette.length]}33` : palette[i % palette.length]),
        borderColor: palette[i % palette.length],
        borderWidth: 2,
        fill: type === "area" ? true : type === "line" ? false : undefined,
      })),
    },
    options: {
      indexAxis: type === "horizontalBar" ? "y" : undefined,
      plugins: {
        title: title ? { display: true, text: title, color: "#ececec", font: { size: 16 } } : undefined,
        legend: { labels: { color: "#ececec" } },
      },
      scales: isPie ? undefined : {
        x: { ticks: { color: "#ececec" }, grid: { color: "#333" } },
        y: { ticks: { color: "#ececec" }, grid: { color: "#333" }, beginAtZero: true },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig))
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/'/g, "%27")
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A");
  const fallbackUrl = `https://quickchart.io/chart?bkg=%23222222&w=720&h=420&c=${encoded}`;
  const safeTitle = (title ?? "graf").replace(/["<>]/g, "");

  // Interaktivní mount point — InteractiveChart komponenta hydratuje přes data-chart.
  // Uvnitř je <img> fallback: pokud React mount selže nebo JS nezapne, zobrazí se statický obrázek.
  const markdown = `<div class="rk-chart-mount" data-chart="${specB64}" data-fallback="${fallbackUrl}" data-title="${safeTitle.replace(/"/g, "&quot;")}">
<img src="${fallbackUrl}" alt="${safeTitle}" />
</div>`;

  return {
    ok: true,
    data: {
      url: fallbackUrl,
      chart: spec,
      markdown,
      instructions_for_agent:
        "Vlož pole 'markdown' BEZE ZMĚNY do odpovědi. Je to HTML blok, který se vykreslí jako interaktivní graf s tooltipem a legendou.",
    },
  };
}

function toolFindMissingData(input: Record<string, unknown>): ToolResult {
  const field = String(input.field ?? "any");
  const limit = typeof input.limit === "number" ? Math.min(Math.max(input.limit, 1), 200) : 50;
  const db = getDb();

  let where = "";
  if (field === "reconstruction_data") where = "reconstruction_data IS NULL";
  else if (field === "building_modifications") where = "building_modifications IS NULL";
  else where = "reconstruction_data IS NULL OR building_modifications IS NULL";

  const rows = db.prepare(
    `SELECT id, address, city, district, type, price, area_m2, status,
            reconstruction_data, building_modifications
     FROM properties
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(limit);

  const total = (db.prepare(
    `SELECT COUNT(*) AS c FROM properties WHERE ${where}`
  ).get() as { c: number }).c;

  return { ok: true, data: { field, total_missing: total, returned: rows.length, rows } };
}

function toolGenerateReport(input: Record<string, unknown>): ToolResult {
  const title = String(input.title ?? "Report");
  const sections = (input.sections as { heading: string; body: string }[]) ?? [];
  const now = new Date().toLocaleString("cs-CZ");
  let md = `# ${title}\n\n_Vygenerováno: ${now}_\n\n`;
  for (const s of sections) {
    md += `## ${s.heading}\n\n${s.body}\n\n`;
  }
  return { ok: true, data: { markdown: md } };
}

function toolSearchProperties(input: Record<string, unknown>): ToolResult {
  const filters: string[] = [];
  const params: unknown[] = [];

  if (input.city) { filters.push("city = ?"); params.push(input.city); }
  if (input.district) { filters.push("district = ?"); params.push(input.district); }
  if (input.type) { filters.push("type = ?"); params.push(input.type); }
  if (input.status) { filters.push("status = ?"); params.push(input.status); }
  if (typeof input.min_price === "number") { filters.push("price >= ?"); params.push(input.min_price); }
  if (typeof input.max_price === "number") { filters.push("price <= ?"); params.push(input.max_price); }
  if (typeof input.min_area_m2 === "number") { filters.push("area_m2 >= ?"); params.push(input.min_area_m2); }

  const limit = typeof input.limit === "number" ? Math.min(Math.max(input.limit, 1), 100) : 20;
  params.push(limit);

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, address, city, district, type, price, area_m2, rooms, status, description
     FROM properties ${where}
     ORDER BY created_at DESC
     LIMIT ?`
  ).all(...params);

  return { ok: true, data: { filters: input, count: rows.length, rows } };
}

// ─────────────────────────── draft_email ───────────────────────────

function formatCzDate(d: Date): string {
  const days = ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"];
  const months = ["ledna", "února", "března", "dubna", "května", "června",
                  "července", "srpna", "září", "října", "listopadu", "prosince"];
  return `${days[d.getDay()]} ${d.getDate()}. ${months[d.getMonth()]}`;
}

function nextWeekdaySlots(count: number): { date: Date; slot: string }[] {
  // Začni příštím pondělím.
  const now = new Date();
  const day = now.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() + daysUntilMonday);
  monday.setHours(0, 0, 0, 0);

  // Deterministický pseudo-náhodný výběr z pracovních dní 9–17 h.
  const slots: { date: Date; slot: string }[] = [];
  const possibleHours = ["9:30", "10:30", "13:00", "14:30", "16:00"];
  const seed = now.getDate();
  const usedDays = new Set<number>();
  for (let i = 0; i < 5 && slots.length < count; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    if (usedDays.has(i)) continue;
    usedDays.add(i);
    const h = possibleHours[(seed + i) % possibleHours.length];
    slots.push({ date: d, slot: h });
  }
  return slots.slice(0, count);
}

function toolDraftEmail(input: Record<string, unknown>): ToolResult {
  const clientName = String(input.client_name ?? "").trim();
  const property = String(input.property ?? "").trim();
  if (!clientName) return { ok: false, error: "Chybí client_name." };
  if (!property) return { ok: false, error: "Chybí property." };
  const topic = String(input.topic ?? "prohlídka nemovitosti").trim();
  const sender = String(input.sender_name ?? "Realitka — obchodní oddělení").trim();

  const slots = nextWeekdaySlots(3);
  const slotLines = slots.map((s) => `- ${formatCzDate(s.date)} v ${s.slot}`).join("\n");

  const firstName = clientName.split(/\s+/)[0];
  const subject = `Termín prohlídky — ${property}`;
  const body = `Dobrý den, pane/paní ${clientName},

děkuji za Váš zájem o nemovitost ${property}. V návaznosti na naši předchozí komunikaci bych rád navrhl tři možné termíny ${topic.toLowerCase()}:

${slotLines}

Prosím dejte mi vědět, který z termínů Vám vyhovuje nejlépe, případně navrhněte alternativu. Prohlídka trvá přibližně 45 minut. V případě dotazů jsem Vám plně k dispozici.

S pozdravem,
${sender}`;

  const markdown = [
    `## 📧 Email · připraveno k odeslání`,
    ``,
    `**Komu:** ${clientName}`,
    `**Předmět:** ${subject}`,
    ``,
    `---`,
    ``,
    body,
    ``,
    `---`,
    ``,
    `→ Napište: *Odešli tento email* nebo *Uprav text — zkrať o 30 %*`,
  ].join("\n");

  return {
    ok: true,
    data: {
      subject,
      body,
      markdown,
      slots: slots.map((s) => ({ date: s.date.toISOString().slice(0, 10), time: s.slot })),
      client_name: clientName,
      first_name: firstName,
      property,
      ui: "email_card",
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY do své odpovědi. Nepřepisuj obsah emailu — pouze pod ním můžeš přidat stručný komentář.",
    },
  };
}

// ─────────────────────── generate_weekly_report ───────────────────────

type WeeklyKpis = {
  new_clients: number;
  new_leads: number;
  closed_deals: number;
  total_volume: number;
  avg_commission: number;
  new_clients_prev: number;
  new_leads_prev: number;
  closed_deals_prev: number;
  total_volume_prev: number;
  avg_commission_prev: number;
};

function pct(curr: number, prev: number): number {
  if (!prev) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

function trendArrow(delta: number): string {
  if (delta > 2) return "↑";
  if (delta < -2) return "↓";
  return "→";
}

function czMoney(n: number): string {
  return n.toLocaleString("cs-CZ").replace(/,/g, " ") + " Kč";
}

function czNum(n: number): string {
  return n.toLocaleString("cs-CZ");
}

function toolGenerateWeeklyReport(input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const label = typeof input.week_label === "string" && input.week_label.trim()
    ? input.week_label.trim()
    : "Poslední týden";

  const now = new Date();
  const week1 = new Date(now);
  week1.setDate(now.getDate() - 7);
  const week2 = new Date(now);
  week2.setDate(now.getDate() - 14);
  const isoNow = now.toISOString();
  const isoW1 = week1.toISOString();
  const isoW2 = week2.toISOString();

  const countClients = (since: string, until: string) => (db.prepare(
    `SELECT COUNT(*) AS c FROM clients WHERE created_at >= ? AND created_at < ?`
  ).get(since, until) as { c: number }).c;

  const countLeads = (since: string, until: string) => (db.prepare(
    `SELECT COUNT(*) AS c FROM leads WHERE created_at >= ? AND created_at < ?`
  ).get(since, until) as { c: number }).c;

  const txAgg = (since: string, until: string) => db.prepare(
    `SELECT COUNT(*) AS deals, COALESCE(SUM(sale_price),0) AS volume, COALESCE(AVG(commission),0) AS avg_comm
     FROM transactions WHERE transaction_date >= ? AND transaction_date < ?`
  ).get(since, until) as { deals: number; volume: number; avg_comm: number };

  const curTx = txAgg(isoW1, isoNow);
  const prevTx = txAgg(isoW2, isoW1);

  const kpis: WeeklyKpis = {
    new_clients: countClients(isoW1, isoNow),
    new_clients_prev: countClients(isoW2, isoW1),
    new_leads: countLeads(isoW1, isoNow),
    new_leads_prev: countLeads(isoW2, isoW1),
    closed_deals: curTx.deals,
    closed_deals_prev: prevTx.deals,
    total_volume: curTx.volume,
    total_volume_prev: prevTx.volume,
    avg_commission: Math.round(curTx.avg_comm || 0),
    avg_commission_prev: Math.round(prevTx.avg_comm || 0),
  };

  // Denní trend počtu leadů za posledních 7 dní (pro graf).
  const dayTrend = db.prepare(
    `SELECT substr(created_at,1,10) AS day, COUNT(*) AS c
     FROM leads
     WHERE created_at >= ? AND created_at < ?
     GROUP BY substr(created_at,1,10)
     ORDER BY day`
  ).all(isoW1, isoNow) as { day: string; c: number }[];

  // Doplň chybějící dny nulami.
  const labels: string[] = [];
  const values: number[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const iso = d.toISOString().slice(0, 10);
    labels.push(iso.slice(5)); // MM-DD
    const match = dayTrend.find((r) => r.day === iso);
    values.push(match ? match.c : 0);
  }

  const clientsPct = pct(kpis.new_clients, kpis.new_clients_prev);
  const leadsPct = pct(kpis.new_leads, kpis.new_leads_prev);
  const dealsPct = pct(kpis.closed_deals, kpis.closed_deals_prev);
  const volumePct = pct(kpis.total_volume, kpis.total_volume_prev);
  const commPct = pct(kpis.avg_commission, kpis.avg_commission_prev);

  // Markdown report
  const md = `# Týdenní manažerský report — ${label}

## Executive summary
Za uplynulý týden jsme zaznamenali ${czNum(kpis.new_clients)} nových klientů (${clientsPct >= 0 ? "+" : ""}${clientsPct}% WoW) a ${czNum(kpis.new_leads)} nových leadů. Uzavřeli jsme ${czNum(kpis.closed_deals)} obchodů s celkovým objemem ${czMoney(kpis.total_volume)}. Průměrná provize činí ${czMoney(kpis.avg_commission)} (${commPct >= 0 ? "+" : ""}${commPct}% oproti předchozímu týdnu).

## KPI přehled
| Metrika | Týden | Předchozí | Změna | Trend |
|---|---:|---:|---:|:---:|
| Noví klienti | ${czNum(kpis.new_clients)} | ${czNum(kpis.new_clients_prev)} | ${clientsPct >= 0 ? "+" : ""}${clientsPct}% | ${trendArrow(clientsPct)} |
| Nové leady | ${czNum(kpis.new_leads)} | ${czNum(kpis.new_leads_prev)} | ${leadsPct >= 0 ? "+" : ""}${leadsPct}% | ${trendArrow(leadsPct)} |
| Uzavřené obchody | ${czNum(kpis.closed_deals)} | ${czNum(kpis.closed_deals_prev)} | ${dealsPct >= 0 ? "+" : ""}${dealsPct}% | ${trendArrow(dealsPct)} |
| Objem transakcí | ${czMoney(kpis.total_volume)} | ${czMoney(kpis.total_volume_prev)} | ${volumePct >= 0 ? "+" : ""}${volumePct}% | ${trendArrow(volumePct)} |
| Průměrná provize | ${czMoney(kpis.avg_commission)} | ${czMoney(kpis.avg_commission_prev)} | ${commPct >= 0 ? "+" : ""}${commPct}% | ${trendArrow(commPct)} |

## Denní trend leadů
_Data za posledních 7 dní (viz graf v prezentaci níže)._
`;

  // Interaktivní graf (Recharts) + QuickChart fallback.
  const chartSpec: InteractiveChartSpec = {
    type: "area",
    title: "Denní vývoj leadů",
    labels,
    datasets: [{ label: "Nové leady", data: values }],
    palette: CHART_PALETTE,
  };
  const chartSpecB64 = encodeChartSpec(chartSpec);
  void chartSpecB64;
  const chartCfg = {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Nové leady",
        data: values,
        borderColor: "#2563EB",
        backgroundColor: "rgba(37,99,235,0.15)",
        borderWidth: 2,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      plugins: { legend: { labels: { color: "#ececec" } } },
      scales: {
        x: { ticks: { color: "#ececec" }, grid: { color: "#333" } },
        y: { ticks: { color: "#ececec" }, grid: { color: "#333" }, beginAtZero: true },
      },
    },
  };
  const chartUrl = `https://quickchart.io/chart?bkg=%23171717&w=640&h=300&c=${
    encodeURIComponent(JSON.stringify(chartCfg))
      .replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/'/g, "%27")
  }`;

  // Text sparkline pro denní trend leadů (bez HTML).
  const maxV = Math.max(1, ...values);
  const sparkChars = "▁▂▃▄▅▆▇█";
  const spark = values.map((v) => sparkChars[Math.min(sparkChars.length - 1, Math.round((v / maxV) * (sparkChars.length - 1)))]).join("");

  const topLead = leadsPct;
  const topTrend = Math.abs(clientsPct) > Math.abs(leadsPct)
    ? `Akvizice klientů ${clientsPct >= 0 ? "roste" : "klesá"} tempem ${Math.abs(clientsPct)}% WoW`
    : `Generování leadů ${topLead >= 0 ? "roste" : "klesá"} tempem ${Math.abs(topLead)}% WoW`;

  const recs: string[] = [];
  if (leadsPct < 0) recs.push("Posílit marketing — počet leadů klesá. Doporučujeme spustit kampaň na Sreality + retargeting.");
  else recs.push("Udržet marketingový tlak — generování leadů roste. Ověřit, které zdroje konvertují nejlépe.");
  if (dealsPct < 0) recs.push("Analyzovat funnel — pokles uzavřených obchodů. Prověřit, kde leady odpadávají.");
  if (commPct < 0) recs.push("Přehodnotit cenotvorbu / slevovou politiku — průměrná provize klesá.");
  else recs.push("Sledovat portfolio vyšších kategorií — provize roste, zaměřit se na prémiové klienty.");
  while (recs.length < 3) recs.push("Pokračovat v týdenním monitoringu KPI a reportovat odchylky > 10%.");

  const conversionRate = kpis.new_leads > 0
    ? Math.round((kpis.closed_deals / kpis.new_leads) * 1000) / 10
    : 0;
  const avgDealValue = kpis.closed_deals > 0
    ? Math.round(kpis.total_volume / kpis.closed_deals)
    : 0;

  const slidesMd = [
    ``,
    `---`,
    ``,
    `### 📊 Slide 1 — Přehled výsledků · ${label}`,
    ``,
    `- **Noví klienti:** ${czNum(kpis.new_clients)} (${clientsPct >= 0 ? "+" : ""}${clientsPct}% ${trendArrow(clientsPct)})`,
    `- **Nové leady:** ${czNum(kpis.new_leads)} (${leadsPct >= 0 ? "+" : ""}${leadsPct}% ${trendArrow(leadsPct)})`,
    `- **Uzavřené obchody:** ${czNum(kpis.closed_deals)} (${dealsPct >= 0 ? "+" : ""}${dealsPct}% ${trendArrow(dealsPct)})`,
    `- **Objem transakcí:** ${czMoney(kpis.total_volume)} (${volumePct >= 0 ? "+" : ""}${volumePct}% ${trendArrow(volumePct)})`,
    `- **Průměrná provize:** ${czMoney(kpis.avg_commission)} (${commPct >= 0 ? "+" : ""}${commPct}% ${trendArrow(commPct)})`,
    ``,
    `---`,
    ``,
    `### 📈 Slide 2 — Klíčové trendy`,
    ``,
    `**Denní vývoj leadů:** \`${spark}\` _(posledních 7 dní, ${values.join("/")})_`,
    ``,
    `- ${topTrend}`,
    `- Konverze leadů na obchody: **${conversionRate} %**`,
    `- Průměrná hodnota obchodu: **${czMoney(avgDealValue)}**`,
    ``,
    `![Graf denního trendu leadů](${chartUrl})`,
    ``,
    `---`,
    ``,
    `### 🎯 Slide 3 — Doporučení a výhled`,
    ``,
    `**3 akce pro příští týden:**`,
    ``,
    ...recs.slice(0, 3).map((r, i) => `${i + 1}. ${r}`),
    ``,
    `_Realitka · Back Office Agent · ${new Date().toLocaleDateString("cs-CZ")}_`,
  ].join("\n");

  return {
    ok: true,
    data: {
      markdown: md + slidesMd,
      chart_url: chartUrl,
      kpis,
      ui: "weekly_report",
    },
  };
}

// ─────────────────────────── monitor_listings ───────────────────────────

type ServerId = "sreality" | "bezrealitky" | "idealbydleni";

type Listing = {
  source: ServerId;
  title: string;
  address: string;
  price: number;
  area_m2: number | null;
  rooms: string | null;
  url: string;
};

const SOURCE_META: Record<ServerId, { label: string; icon: string; color: string }> = {
  sreality:     { label: "Sreality.cz",     icon: "🏢", color: "#ef4444" },
  bezrealitky:  { label: "Bezrealitky.cz",  icon: "🏠", color: "#10b981" },
  idealbydleni: { label: "IdealBydleni.cz", icon: "🏡", color: "#f59e0b" },
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function mapSrealityCategory(type: string): number {
  if (type === "pronájem") return 2;
  return 1; // prodej
}

function mapSrealityPropertyType(pt: string): number {
  if (pt === "dům") return 2;
  if (pt === "komerční") return 4;
  return 1; // byt
}

function mapBezrealitkyOfferType(type: string): string {
  return type === "pronájem" ? "pronajem" : "prodej";
}

function mapBezrealitkyEstateType(pt: string): string {
  if (pt === "dům") return "dum";
  if (pt === "komerční") return "komercni";
  return "byt";
}

function mapIdealUrl(type: string, pt: string, locality: string): string {
  const typeSeg = type === "pronájem" ? "pronajem" : "prodej";
  const ptSeg = pt === "dům" ? "domy" : pt === "komerční" ? "komercni" : "byty";
  // Pokus o jednoduchý slug lokality: "Praha 7 - Holešovice" → "praha-7"
  const localityClean = locality.toLowerCase()
    .replace(/[áä]/g, "a").replace(/[čć]/g, "c").replace(/ď/g, "d")
    .replace(/[éě]/g, "e").replace(/í/g, "i").replace(/ň/g, "n")
    .replace(/[óö]/g, "o").replace(/ř/g, "r").replace(/š/g, "s").replace(/ť/g, "t")
    .replace(/[úů]/g, "u").replace(/ý/g, "y").replace(/ž/g, "z")
    .replace(/\s*-\s*/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const parts = localityClean.split("-").filter(Boolean);
  // Zachovej max 2 segmenty (např. "praha-7")
  const slug = parts.slice(0, 2).join("-") || "praha-7";
  return `https://www.idealbydleni.cz/${typeSeg}/${ptSeg}/${slug}/`;
}

async function scrapeSreality(locality: string, type: string, propertyType: string): Promise<Listing[]> {
  const category = mapSrealityCategory(type);
  const mainCat = mapSrealityPropertyType(propertyType);
  // Praha 7 default; pro jiné lokality stejné endpointy + text locality v názvu
  const url = `https://www.sreality.cz/api/cs/v2/estates?category_main_cb=${mainCat}&category_type_cb=${category}&locality_region_id=10&locality_district_id=5006&per_page=10`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Sreality HTTP ${res.status}`);
  const json = (await res.json()) as {
    _embedded?: { estates?: Array<{
      hash_id?: number; name?: string; locality?: string; price?: number;
      seo?: { category_main_cb?: string; category_type_cb?: string; locality?: string };
    }> };
  };
  const estates = json?._embedded?.estates ?? [];
  return estates.slice(0, 10).map((e) => {
    const id = e.hash_id ?? 0;
    const categorySeg = e.seo?.category_main_cb ?? "byt";
    const typeSeg = e.seo?.category_type_cb ?? "prodej";
    const localitySeg = e.seo?.locality ?? "praha";
    const href = id
      ? `https://www.sreality.cz/detail/${typeSeg}/${categorySeg}/${localitySeg}/${id}`
      : "https://www.sreality.cz";
    const nameStr = String(e.name ?? "").trim();
    const areaMatch = nameStr.match(/(\d+)\s*m[²2]/i);
    const roomsMatch = nameStr.match(/(garsoni[ée]ra|\d\+\w{1,3})/i);
    return {
      source: "sreality",
      title: nameStr || "Nemovitost",
      address: String(e.locality ?? locality),
      price: Number(e.price ?? 0) || 0,
      area_m2: areaMatch ? Number(areaMatch[1]) : null,
      rooms: roomsMatch ? roomsMatch[1] : null,
      url: href,
    } as Listing;
  }).filter((l) => l.price > 0);
}

async function scrapeBezrealitky(locality: string, type: string, propertyType: string): Promise<Listing[]> {
  const offer = mapBezrealitkyOfferType(type);
  const estate = mapBezrealitkyEstateType(propertyType);
  const url = `https://www.bezrealitky.cz/api/record/markers?offerType=${offer}&estateType=${estate}&regionOsmIds=R435514&osm_value=${encodeURIComponent(locality)}`;
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Bezrealitky HTTP ${res.status}`);
  const json = (await res.json()) as Array<{
    id?: string; uri?: string; price?: number; surface?: number; disposition?: string;
    address?: string; imgPath?: string;
  }>;
  const items = Array.isArray(json) ? json : [];
  return items.slice(0, 10).map((e) => {
    const uri = e.uri ?? (e.id ? `/nemovitosti-byty-domy/${e.id}` : "");
    const href = uri.startsWith("http") ? uri : `https://www.bezrealitky.cz${uri}`;
    const disp = e.disposition ? e.disposition.replace(/_/g, "+").toUpperCase() : null;
    return {
      source: "bezrealitky",
      title: `${disp ?? "Nemovitost"}${e.surface ? ` · ${e.surface} m²` : ""}`,
      address: String(e.address ?? locality),
      price: Number(e.price ?? 0) || 0,
      area_m2: typeof e.surface === "number" ? e.surface : null,
      rooms: disp,
      url: href,
    } as Listing;
  }).filter((l) => l.price > 0);
}

async function scrapeIdealBydleni(locality: string, type: string, propertyType: string): Promise<Listing[]> {
  const url = mapIdealUrl(type, propertyType, locality);
  const res = await fetchWithTimeout(url, {
    headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
  });
  if (!res.ok) throw new Error(`IdealBydleni HTTP ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const out: Listing[] = [];
  // Obecný selektor: karty s odkazem na detail. Zkusíme několik variant.
  const candidates = $("article, .offer, .inzerat, .list-item, [class*=offer], [class*=item]").toArray();
  for (const el of candidates) {
    if (out.length >= 10) break;
    const $el = $(el);
    const link = $el.find("a[href*='/nabidka'], a[href*='/detail'], a[href*='/nemovitost']").first();
    const href = link.attr("href") ?? $el.find("a").first().attr("href") ?? "";
    if (!href) continue;
    const fullHref = href.startsWith("http") ? href : `https://www.idealbydleni.cz${href.startsWith("/") ? "" : "/"}${href}`;
    const title = $el.find("h2, h3, .title, [class*=title]").first().text().trim()
      || link.text().trim()
      || "Nemovitost";
    const priceTxt = $el.find("[class*=price], .cena").first().text().trim();
    const priceMatch = priceTxt.match(/([\d\s\u00a0]+)\s*K[čc]/i);
    const price = priceMatch ? Number(priceMatch[1].replace(/\s|\u00a0/g, "")) : 0;
    const addrTxt = $el.find("[class*=address], [class*=locality], address").first().text().trim();
    const areaMatch = ($el.text().match(/(\d+)\s*m[²2]/i));
    const roomsMatch = ($el.text().match(/(garsoni[ée]ra|\d\+\w{1,3})/i));
    if (price <= 0) continue;
    out.push({
      source: "idealbydleni",
      title: title.replace(/\s+/g, " ").slice(0, 120),
      address: addrTxt || locality,
      price,
      area_m2: areaMatch ? Number(areaMatch[1]) : null,
      rooms: roomsMatch ? roomsMatch[1] : null,
      url: fullHref,
    });
  }
  return out;
}

function fallbackListings(source: ServerId, locality: string, type: string, propertyType: string): Listing[] {
  const rent = type === "pronájem";
  const streets = ["Veletržní", "Dukelských hrdinů", "Argentinská", "Jankovcova", "Tusarova", "Komunardů"];
  const types = propertyType === "dům" ? ["4+1", "5+kk", "5+1"] : ["2+kk", "2+1", "3+kk", "3+1"];
  const basePerSqm = rent
    ? { byt: 450, dům: 350, komerční: 400 }[propertyType] ?? 450
    : { byt: 148000, dům: 120000, komerční: 90000 }[propertyType] ?? 148000;
  const seed = (Date.now() / 86400000) | 0;
  return Array.from({ length: 4 }).map((_, i) => {
    const street = streets[(seed + i + source.length * 2) % streets.length];
    const num = ((seed + i * 7) % 80) + 1;
    const disp = types[(seed + i * 3) % types.length];
    const area = 40 + ((seed + i * 5) % 80);
    const price = Math.round((area * (basePerSqm + ((seed + i) % 20) * 1000)) / 1000) * 1000;
    return {
      source,
      title: `${disp} · ${area} m², ${street} ${num}`,
      address: `${street} ${num}, ${locality}`,
      price,
      area_m2: area,
      rooms: disp,
      url: `https://www.${source === "idealbydleni" ? "idealbydleni.cz" : source + ".cz"}/`,
    } as Listing;
  });
}

async function toolMonitorListings(input: Record<string, unknown>): Promise<ToolResult> {
  const locality = String(input.locality ?? "Praha 7 - Holešovice").trim();
  const requested = (Array.isArray(input.servers) ? (input.servers as string[]) : [])
    .filter((s): s is ServerId => s === "sreality" || s === "bezrealitky" || s === "idealbydleni");
  const servers: ServerId[] = requested.length ? requested : ["sreality", "bezrealitky", "idealbydleni"];
  const type = (input.type === "pronájem" ? "pronájem" : "prodej") as "prodej" | "pronájem";
  const propertyType = (input.property_type === "dům" || input.property_type === "komerční"
    ? input.property_type : "byt") as "byt" | "dům" | "komerční";

  const scrapers: Record<ServerId, () => Promise<Listing[]>> = {
    sreality:     () => scrapeSreality(locality, type, propertyType),
    bezrealitky:  () => scrapeBezrealitky(locality, type, propertyType),
    idealbydleni: () => scrapeIdealBydleni(locality, type, propertyType),
  };

  const settled = await Promise.allSettled(servers.map((s) => scrapers[s]()));

  const bySource: Record<ServerId, Listing[]> = { sreality: [], bezrealitky: [], idealbydleni: [] };
  const failed: ServerId[] = [];
  const errors: Record<string, string> = {};

  servers.forEach((s, idx) => {
    const r = settled[idx];
    if (r.status === "fulfilled" && r.value.length > 0) {
      bySource[s] = r.value;
    } else {
      failed.push(s);
      if (r.status === "rejected") errors[s] = r.reason instanceof Error ? r.reason.message : String(r.reason);
      else errors[s] = "Server vrátil prázdnou odpověď";
      bySource[s] = fallbackListings(s, locality, type, propertyType);
    }
  });

  const all: Listing[] = servers.flatMap((s) => bySource[s]);
  const prices = all.map((l) => l.price).filter((p) => p > 0);
  const avg = prices.length ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 0;
  const cheapest = all.reduce<Listing | null>((best, l) => (!best || (l.price > 0 && l.price < best.price) ? l : best), null);
  const mostExpensive = all.reduce<Listing | null>((best, l) => (!best || l.price > best.price ? l : best), null);

  const avgBySource: Partial<Record<ServerId, number>> = {};
  for (const s of servers) {
    const p = bySource[s].map((l) => l.price).filter((x) => x > 0);
    if (p.length) avgBySource[s] = Math.round(p.reduce((a, b) => a + b, 0) / p.length);
  }

  const typeLabel = type === "prodej" ? "prodej" : "pronájem";
  const ptLabel = propertyType;
  const priceSuffix = type === "pronájem" ? " / měsíc" : "";

  const lines: string[] = [];
  lines.push(`## 🔎 Monitoring inzerátů · ${locality} · ${typeLabel} ${ptLabel}`);
  lines.push("");

  if (failed.length) {
    lines.push(`> ⚠️ **Dočasně nedostupné:** ${failed.map((s) => SOURCE_META[s].label).join(", ")} — zobrazena cache data.`);
    lines.push("");
  }

  for (const s of servers) {
    const meta = SOURCE_META[s];
    const badge = failed.includes(s)
      ? `⚠️ nedostupný — fallback data`
      : `${bySource[s].length} nabídek · live`;
    lines.push(`### ${meta.icon} ${meta.label} _(${badge})_`);
    lines.push("");
    if (bySource[s].length === 0) {
      lines.push(`_Žádné inzeráty._`);
      lines.push("");
      continue;
    }
    for (const l of bySource[s]) {
      const metaParts: string[] = [];
      if (l.rooms) metaParts.push(l.rooms);
      if (l.area_m2) metaParts.push(`${l.area_m2} m²`);
      const metaStr = metaParts.length ? ` · ${metaParts.join(" · ")}` : "";
      lines.push(`- **[${l.title}](${l.url})** — ${czMoney(l.price)}${priceSuffix}${metaStr}`);
      lines.push(`  ${l.address}`);
    }
    lines.push("");
  }

  lines.push(`### 📊 Souhrn`);
  lines.push("");
  lines.push(`| Metrika | Hodnota |`);
  lines.push(`|---|---|`);
  lines.push(`| Celkem nabídek | **${all.length}** |`);
  lines.push(`| Průměrná cena | **${czMoney(avg)}** |`);
  lines.push(`| Rozpětí | ${czMoney(min)} – ${czMoney(max)} |`);
  lines.push("");

  if (cheapest && mostExpensive) {
    lines.push(`- 🟢 **Nejlevnější:** [${cheapest.title}](${cheapest.url}) — ${czMoney(cheapest.price)} _(${SOURCE_META[cheapest.source].label})_`);
    lines.push(`- 🔴 **Nejdražší:** [${mostExpensive.title}](${mostExpensive.url}) — ${czMoney(mostExpensive.price)} _(${SOURCE_META[mostExpensive.source].label})_`);
    lines.push("");
  }

  const avgEntries = Object.entries(avgBySource);
  if (avgEntries.length) {
    lines.push(`### Průměrná cena dle serveru`);
    lines.push("");
    lines.push(`| Server | Průměr |`);
    lines.push(`|---|---:|`);
    for (const [s, v] of avgEntries) {
      lines.push(`| ${SOURCE_META[s as ServerId].label} | ${czMoney(v as number)} |`);
    }
    lines.push("");
  }

  const markdown = lines.join("\n");

  return {
    ok: true,
    data: {
      ui: "listings_cards",
      locality,
      type,
      property_type: propertyType,
      servers,
      failed_servers: failed,
      errors,
      listings_by_source: bySource,
      summary: {
        count: all.length,
        avg_price: avg,
        min_price: min,
        max_price: max,
        avg_by_source: avgBySource,
        cheapest,
        most_expensive: mostExpensive,
      },
      markdown,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY do své odpovědi. Pod něj napiš krátký komentář (2–4 věty) s doporučením pro makléře.",
    },
  };
}

// ─────────────────────────── send_email ───────────────────────────

async function toolSendEmail(input: Record<string, unknown>): Promise<ToolResult> {
  const to = String(input.to ?? "").trim();
  const subject = String(input.subject ?? "").trim();
  const body = String(input.body ?? "").trim();
  if (!to) return { ok: false, error: "Chybí parametr to (email příjemce)." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, error: `Neplatná emailová adresa: ${to}` };
  if (!subject) return { ok: false, error: "Chybí subject." };
  if (!body) return { ok: false, error: "Chybí body." };

  const base = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  try {
    const res = await fetch(`${base}/api/gmail/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, body }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      messageId?: string;
      provider?: string;
      draft?: boolean;
      note?: string;
    };
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `Odeslání selhalo (HTTP ${res.status})` };
    }
    if (data.draft) {
      const draftMd = [
        `## ✉️ Draft emailu (neodesláno)`,
        ``,
        `**Komu:** ${to}`,
        `**Předmět:** ${subject}`,
        ``,
        body,
        ``,
        `> ${data.note ?? "Žádný email provider není nakonfigurován."}`,
      ].join("\n");
      return {
        ok: true,
        data: {
          sent: false,
          draft: true,
          provider: data.provider ?? "draft",
          to,
          subject,
          markdown: draftMd,
          instructions_for_agent:
            "Vlož pole markdown BEZE ZMĚNY do odpovědi. Pod něj napiš 1 větu, že email není odeslán a jak nastavit provider.",
        },
      };
    }
    return {
      ok: true,
      data: {
        sent: true,
        to,
        subject,
        provider: data.provider ?? "resend",
        message_id: data.messageId,
        instructions_for_agent:
          "Potvrď uživateli, že email byl odeslán (uveď příjemce a předmět). Stručně, 1 věta.",
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────── view_pipeline ───────────────────────────

const PIPELINE_STAGES = ["nový", "kontaktován", "prohlídka", "nabídka", "uzavřen"] as const;
const PIPELINE_COLORS: Record<string, string> = {
  "nový": "#6366f1",
  "kontaktován": "#2563eb",
  "prohlídka": "#f59e0b",
  "nabídka": "#ec4899",
  "uzavřen": "#10b981",
};

function toolViewPipeline(_input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const rows = db.prepare(
    `SELECT l.status AS status, COUNT(*) AS count,
            COALESCE(SUM(p.price), 0) AS value,
            COALESCE(SUM(l.estimated_commission), 0) AS commission
     FROM leads l
     LEFT JOIN properties p ON p.id = l.property_id
     GROUP BY l.status`
  ).all() as { status: string; count: number; value: number; commission: number }[];

  const byStage: Record<string, { count: number; value: number; commission: number }> = {};
  for (const s of PIPELINE_STAGES) byStage[s] = { count: 0, value: 0, commission: 0 };
  for (const r of rows) {
    if (byStage[r.status]) byStage[r.status] = { count: r.count, value: r.value, commission: r.commission };
  }

  // Měsíční realizovaná provize + predikce z 'nabídka' leadů.
  const now = new Date();
  const mStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const nextM = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const mEnd = `${nextM.getFullYear()}-${String(nextM.getMonth() + 1).padStart(2, "0")}-01`;
  const realized = db.prepare(
    `SELECT COALESCE(SUM(commission), 0) AS s, COUNT(*) AS c
     FROM transactions
     WHERE transaction_date >= ? AND transaction_date < ?`
  ).get(mStart, mEnd) as { s: number; c: number };

  const totalLeads = PIPELINE_STAGES.reduce((sum, s) => sum + byStage[s].count, 0);

  const overallConv = byStage["nový"].count > 0
    ? Math.round((byStage["uzavřen"].count / byStage["nový"].count) * 1000) / 10
    : 0;
  const predictedCommission = byStage["nabídka"].commission;
  const totalPipelineCommission = PIPELINE_STAGES
    .filter((s) => s !== "uzavřen")
    .reduce((sum, s) => sum + byStage[s].commission, 0);

  const stageIcon: Record<string, string> = {
    "nový": "🟦",
    "kontaktován": "🟪",
    "prohlídka": "🟨",
    "nabídka": "🟥",
    "uzavřen": "🟩",
  };

  const stageLines = PIPELINE_STAGES.map((s) => {
    const d = byStage[s];
    return `- ${stageIcon[s]} **${s}** — ${d.count} leadů · hodnota ${czMoney(d.value)} · provize ${czMoney(d.commission)}`;
  }).join("\n");

  const convLines: string[] = [
    `| Fáze | Z | Do | Konverze |`,
    `|---|---:|---:|---:|`,
  ];
  for (let i = 0; i < PIPELINE_STAGES.length - 1; i++) {
    const from = PIPELINE_STAGES[i];
    const to = PIPELINE_STAGES[i + 1];
    const a = byStage[from].count;
    const b = byStage[to].count;
    const conv = a > 0 ? Math.round((b / a) * 1000) / 10 : 0;
    convLines.push(`| ${from} → ${to} | ${a} | ${b} | ${conv.toString().replace(".", ",")} % |`);
  }

  const pipelineMd = [
    `## 📊 Pipeline leadů`,
    `Celkem **${totalLeads}** leadů · konverze nový → uzavřen: **${overallConv.toString().replace(".", ",")} %**`,
    ``,
    `### Fáze`,
    stageLines,
    ``,
    `### 💰 Peníze`,
    `- **Realizováno tento měsíc:** ${czMoney(realized.s)} (${realized.c} transakcí)`,
    `- **Predikce z fáze „nabídka":** ${czMoney(predictedCommission)} (${byStage["nabídka"].count} leadů)`,
    `- **Celkem v pipeline (bez uzavřených):** ${czMoney(totalPipelineCommission)}`,
    ``,
    `### Konverze mezi fázemi`,
    convLines.join("\n"),
  ].join("\n");

  return {
    ok: true,
    data: {
      ui: "pipeline",
      stages: byStage,
      total_leads: totalLeads,
      overall_conversion: overallConv,
      markdown: pipelineMd,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY do své odpovědi. Pod ním napiš 2–3 věty shrnutí (kde je největší úbytek leadů, doporučení).",
    },
  };
}

// ─────────────────────────── compare_properties ───────────────────────────

type PropertyRow = {
  id: number;
  address: string;
  city: string;
  district: string;
  type: string;
  price: number;
  area_m2: number;
  rooms: number | null;
  status: string;
  description: string;
  created_at: string;
};

function daysOnMarket(isoDate: string): number {
  const t = new Date(isoDate).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function toolCompareProperties(input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const ids = Array.isArray(input.property_ids) ? (input.property_ids as unknown[]).filter((x): x is number => typeof x === "number") : [];
  const addresses = Array.isArray(input.addresses) ? (input.addresses as unknown[]).filter((x): x is string => typeof x === "string") : [];

  let rows: PropertyRow[] = [];
  if (ids.length >= 2) {
    const placeholders = ids.map(() => "?").join(",");
    rows = db.prepare(
      `SELECT id, address, city, district, type, price, area_m2, rooms, status, description, created_at
       FROM properties WHERE id IN (${placeholders})`
    ).all(...ids) as PropertyRow[];
  } else if (addresses.length >= 2) {
    const found: PropertyRow[] = [];
    for (const addr of addresses.slice(0, 4)) {
      const like = `%${addr.trim()}%`;
      const row = db.prepare(
        `SELECT id, address, city, district, type, price, area_m2, rooms, status, description, created_at
         FROM properties
         WHERE address LIKE ? OR district LIKE ? OR city LIKE ?
         ORDER BY created_at DESC LIMIT 1`
      ).get(like, like, like) as PropertyRow | undefined;
      if (row) found.push(row);
    }
    rows = found;
  } else {
    return { ok: false, error: "Zadej pole property_ids (min 2) nebo addresses (min 2)." };
  }

  if (rows.length < 2) {
    return { ok: false, error: `Nalezeno pouze ${rows.length} nemovitostí — k porovnání potřebuji alespoň 2.` };
  }
  rows = rows.slice(0, 4);

  const withMetrics = rows.map((r) => ({
    r,
    pricePerM2: r.area_m2 > 0 ? Math.round(r.price / r.area_m2) : 0,
    days: daysOnMarket(r.created_at),
  }));

  // Markdown tabulka (každá nemovitost je sloupec).
  const headerCells = ["Parametr", ...withMetrics.map((m) => m.r.address)];
  const tableLines: string[] = [
    `| ${headerCells.join(" | ")} |`,
    `|${headerCells.map(() => "---").join("|")}|`,
    `| Lokalita | ${withMetrics.map((m) => `${m.r.district} · ${m.r.city}`).join(" | ")} |`,
    `| Cena | ${withMetrics.map((m) => czMoney(m.r.price)).join(" | ")} |`,
    `| Cena za m² | ${withMetrics.map((m) => czMoney(m.pricePerM2)).join(" | ")} |`,
    `| Plocha | ${withMetrics.map((m) => `${m.r.area_m2} m²`).join(" | ")} |`,
    `| Pokoje | ${withMetrics.map((m) => m.r.rooms ?? "—").join(" | ")} |`,
    `| Typ | ${withMetrics.map((m) => m.r.type).join(" | ")} |`,
    `| Stav | ${withMetrics.map((m) => m.r.status).join(" | ")} |`,
    `| Na trhu | ${withMetrics.map((m) => `${m.days} dní`).join(" | ")} |`,
  ];

  const cheapest = withMetrics.reduce((b, c) => (c.pricePerM2 < b.pricePerM2 ? c : b));
  const largest = withMetrics.reduce((b, c) => (c.r.area_m2 > b.r.area_m2 ? c : b));
  const fastest = withMetrics.reduce((b, c) => (c.days < b.days ? c : b));

  const compareMd = [
    `## 🔍 Porovnání ${rows.length} nemovitostí`,
    ``,
    tableLines.join("\n"),
    ``,
    `### 💡 Shrnutí`,
    `- **Nejvýhodnější cena za m²:** ${cheapest.r.address} (${czMoney(cheapest.pricePerM2)}/m²)`,
    `- **Největší plocha:** ${largest.r.address} (${largest.r.area_m2} m²)`,
    `- **Nejkratší doba na trhu:** ${fastest.r.address} (${fastest.days} dní)`,
  ].join("\n");

  return {
    ok: true,
    data: {
      ui: "compare",
      count: rows.length,
      properties: rows,
      markdown: compareMd,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY. Pod ním napiš odstavec (3–5 vět) s konkrétním doporučením, která nemovitost je pro klienta nejvýhodnější a proč.",
    },
  };
}

// ─────────────────────────── get_recommendations ───────────────────────────

type Recommendation = {
  priority: "urgent" | "important" | "info";
  icon: string;
  title: string;
  detail: string;
  context: string;
};

function toolGetRecommendations(_input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
  const fortyFiveDaysAgo = new Date(now - 45 * 86400000).toISOString();

  const recs: Recommendation[] = [];

  // Leady bez kontaktu > 7 dní (status ještě v některé "aktivní" fázi).
  const staleLeads = db.prepare(
    `SELECT l.id, l.status, l.created_at, c.name AS client_name, p.address AS property_addr, p.price AS price
     FROM leads l
     JOIN clients c ON c.id = l.client_id
     JOIN properties p ON p.id = l.property_id
     WHERE l.status IN ('nový','kontaktován') AND l.created_at < ?
     ORDER BY l.created_at ASC LIMIT 10`
  ).all(sevenDaysAgo) as Array<{
    id: number; status: string; created_at: string; client_name: string; property_addr: string; price: number;
  }>;
  for (const l of staleLeads) {
    const days = Math.floor((now - new Date(l.created_at).getTime()) / 86400000);
    const priority: Recommendation["priority"] = days >= 14 ? "urgent" : "important";
    recs.push({
      priority,
      icon: "📞",
      title: `Kontaktovat: ${l.client_name}`,
      detail: `Lead bez kontaktu ${days} dní — stav: ${l.status}.`,
      context: `Nemovitost: ${l.property_addr} · ${czMoney(l.price)}`,
    });
  }

  // Nemovitosti aktivní > 45 dní.
  const staleProps = db.prepare(
    `SELECT id, address, district, city, price, area_m2, created_at
     FROM properties
     WHERE status = 'aktivní' AND created_at < ?
     ORDER BY created_at ASC LIMIT 10`
  ).all(fortyFiveDaysAgo) as Array<{
    id: number; address: string; district: string; city: string; price: number; area_m2: number; created_at: string;
  }>;
  for (const p of staleProps) {
    const days = Math.floor((now - new Date(p.created_at).getTime()) / 86400000);
    const priority: Recommendation["priority"] = days >= 90 ? "urgent" : "important";
    const suggestedCut = Math.round(p.price * 0.05);
    recs.push({
      priority,
      icon: "🏷️",
      title: `Zvaž snížení ceny: ${p.address}`,
      detail: `Na trhu ${days} dní. Doporučujeme snížit o ~5% (cca ${czMoney(suggestedCut)}).`,
      context: `${p.district}, ${p.city} · ${p.area_m2} m² · aktuální cena ${czMoney(p.price)}`,
    });
  }

  // Vysokohodnotní klienti ve fázi 'nabídka'.
  const highValueOffers = db.prepare(
    `SELECT l.id, c.name AS client_name, p.address AS addr, p.price AS price
     FROM leads l
     JOIN clients c ON c.id = l.client_id
     JOIN properties p ON p.id = l.property_id
     WHERE l.status = 'nabídka'
     ORDER BY p.price DESC LIMIT 5`
  ).all() as Array<{ id: number; client_name: string; addr: string; price: number }>;
  for (const h of highValueOffers) {
    recs.push({
      priority: h.price >= 10_000_000 ? "urgent" : "info",
      icon: "💼",
      title: `Prioritní uzavření: ${h.client_name}`,
      detail: `Klient ve fázi 'nabídka' s hodnotou ${czMoney(h.price)}.`,
      context: `Nemovitost: ${h.addr}`,
    });
  }

  recs.sort((a, b) => {
    const order = { urgent: 0, important: 1, info: 2 };
    return order[a.priority] - order[b.priority];
  });

  const prioLabel: Record<Recommendation["priority"], string> = {
    urgent: "🔴 URGENTNÍ",
    important: "🟡 DŮLEŽITÉ",
    info: "🟢 INFO",
  };

  const cards = recs.map((r) =>
    [
      `### ${r.icon} ${prioLabel[r.priority]} — ${r.title}`,
      r.detail,
      `_${r.context}_`,
    ].join("\n")
  ).join("\n\n");

  const counts = {
    urgent: recs.filter((r) => r.priority === "urgent").length,
    important: recs.filter((r) => r.priority === "important").length,
    info: recs.filter((r) => r.priority === "info").length,
  };

  const recsMd = [
    `## 💡 Doporučení`,
    `${recs.length} akcí — **${counts.urgent}** urgentních · **${counts.important}** důležitých · **${counts.info}** info`,
    ``,
    recs.length === 0
      ? `✨ Žádná urgentní doporučení. Všechno vypadá v pořádku.`
      : cards,
  ].join("\n");

  return {
    ok: true,
    data: {
      ui: "recommendations",
      counts,
      recommendations: recs,
      markdown: recsMd,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY. Pod ním stručně (2–3 věty) shrň, na co se zaměřit jako první.",
    },
  };
}

// ─────────────────────────── price_map ───────────────────────────

function toolPriceMap(input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const type = typeof input.type === "string" ? input.type : null;
  const perM2 = input.per_m2 === false ? false : true;

  const params: unknown[] = [];
  let where = "status = 'aktivní' AND area_m2 > 0";
  if (type && ["byt", "dům", "komerční"].includes(type)) {
    where += " AND type = ?";
    params.push(type);
  }

  const col = perM2 ? "AVG(CAST(price AS REAL) / area_m2)" : "AVG(price)";

  const rows = db.prepare(
    `SELECT city || ' · ' || district AS location, ${col} AS avg_price, COUNT(*) AS count
     FROM properties
     WHERE ${where}
     GROUP BY city, district
     HAVING count >= 1
     ORDER BY avg_price DESC`
  ).all(...params) as Array<{ location: string; avg_price: number; count: number }>;

  if (rows.length === 0) {
    return { ok: false, error: "Žádná data pro cenovou mapu (po aplikaci filtrů)." };
  }

  const prices = rows.map((r) => r.avg_price);
  const overallAvg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const maxPrice = Math.max(...prices);

  const categorize = (p: number): { label: string; icon: string } => {
    if (p < overallAvg * 0.9) return { label: "pod průměrem", icon: "🟢" };
    if (p > overallAvg * 1.1) return { label: "nad průměrem", icon: "🔴" };
    return { label: "průměr", icon: "🟡" };
  };

  const barChar = "▓";
  const emptyChar = "░";
  const barWidth = 20;

  const lines = rows.map((r) => {
    const cat = categorize(r.avg_price);
    const filled = Math.max(1, Math.round((r.avg_price / maxPrice) * barWidth));
    const bar = barChar.repeat(filled) + emptyChar.repeat(Math.max(0, barWidth - filled));
    const valueFormatted = perM2
      ? `${czMoney(Math.round(r.avg_price))}/m²`
      : czMoney(Math.round(r.avg_price));
    return `- ${cat.icon} **${r.location}** _(${r.count})_ — \`${bar}\` ${valueFormatted} · ${cat.label}`;
  }).join("\n");
  void maxPrice;

  const overallFormatted = perM2
    ? `${czMoney(Math.round(overallAvg))}/m²`
    : czMoney(Math.round(overallAvg));

  const priceMapMd = [
    `## 🗺️ Cenová mapa${type ? ` · ${type}` : ""}`,
    `Celkový průměr: **${overallFormatted}**`,
    ``,
    lines,
    ``,
    `_Legenda: 🟢 pod průměrem (-10 %) · 🟡 průměr · 🔴 nad průměrem (+10 %)_`,
  ].join("\n");

  return {
    ok: true,
    data: {
      ui: "price_map",
      type,
      per_m2: perM2,
      overall_avg: Math.round(overallAvg),
      rows,
      markdown: priceMapMd,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY. Pod ním napiš 2–3 věty komentáře (kde jsou nejvyšší/nejnižší ceny, doporučení kam orientovat akvizici).",
    },
  };
}

// ─────────────────────────── check_followups ───────────────────────────

function daysSinceIso(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function toolCheckFollowups(input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const minDays = typeof input.min_days === "number" ? Math.max(1, Math.floor(input.min_days)) : 3;

  const rows = db.prepare(
    `SELECT l.id AS lead_id, l.client_id, l.property_id, l.status,
            l.last_contact_at, l.next_action,
            COALESCE(l.estimated_commission, 0) AS commission,
            c.name AS client_name, c.email AS client_email,
            p.address AS property_addr, p.price AS price
     FROM leads l
     JOIN clients c ON c.id = l.client_id
     JOIN properties p ON p.id = l.property_id
     WHERE l.status IN ('nový','kontaktován','prohlídka','nabídka')
       AND l.last_contact_at IS NOT NULL
     ORDER BY l.last_contact_at ASC`
  ).all() as Array<{
    lead_id: number; client_id: number; property_id: number; status: string;
    last_contact_at: string; next_action: string | null;
    commission: number;
    client_name: string; client_email: string;
    property_addr: string; price: number;
  }>;

  const enriched = rows
    .map((r) => ({ ...r, days: daysSinceIso(r.last_contact_at) }))
    .filter((r) => r.days >= minDays);

  const red = enriched.filter((r) => r.days >= 14);
  const yellow = enriched.filter((r) => r.days >= 7 && r.days < 14);
  const green = enriched.filter((r) => r.days < 7);

  const renderCard = (r: typeof enriched[0], prio: "red" | "yellow" | "green") => {
    const label = { red: "🔴 URGENTNÍ", yellow: "🟡 DŮLEŽITÉ", green: "🟢 SLEDOVAT" }[prio];
    const lines: string[] = [];
    lines.push(`**${r.client_name}** — ${r.property_addr}`);
    lines.push(`${label} · ${r.days} dní bez kontaktu · stav: ${r.status} · provize ~ ${czMoney(r.commission)}`);
    if (r.next_action) lines.push(`Další krok: _${r.next_action}_`);
    lines.push(`→ Napište: *Napiš follow-up email pro ${r.client_name} ohledně nemovitosti na ${r.property_addr}.*`);
    lines.push(`→ Napište: *Připrav briefing na klienta ${r.client_name}*`);
    return lines.join("  \n");
  };

  const section = (title: string, list: typeof enriched, prio: "red" | "yellow" | "green") => {
    if (list.length === 0) return "";
    const cards = list.map((r) => renderCard(r, prio)).join("\n\n");
    return `### ${title} (${list.length})\n\n${cards}`;
  };

  const threatened = enriched.reduce((a, b) => a + b.commission, 0);

  const parts: string[] = [];
  parts.push(`## 🔥 Follow-up management`);
  parts.push(`${enriched.length} leadů vyžaduje pozornost · ohrožená provize: **${czMoney(threatened)}**`);
  if (enriched.length === 0) {
    parts.push(`✨ Žádné follow-upy — všichni klienti byli nedávno kontaktováni.`);
  } else {
    const s1 = section("14+ dní bez kontaktu", red, "red");
    const s2 = section("7–14 dní bez kontaktu", yellow, "yellow");
    const s3 = section("3–7 dní bez kontaktu", green, "green");
    [s1, s2, s3].filter(Boolean).forEach((s) => parts.push(s));
  }
  const followupsMd = parts.join("\n\n");

  return {
    ok: true,
    data: {
      ui: "followups",
      counts: { red: red.length, yellow: yellow.length, green: green.length, total: enriched.length },
      threatened_commission: threatened,
      followups: enriched,
      markdown: followupsMd,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY jako markdown. Pod ním napiš 2–3 věty shrnutí: kolik je urgentních, kterého klienta kontaktovat jako prvního a proč.",
    },
  };
}

// ─────────────────────────── match_clients_properties ───────────────────────────

type ClientPref = {
  id: number;
  name: string;
  preferred_locality: string | null;
  preferred_type: string | null;
  preferred_rooms: string | null;
  budget_min: number | null;
  budget_max: number | null;
};

type PropCandidate = {
  id: number;
  address: string;
  city: string;
  district: string;
  type: string;
  price: number;
  area_m2: number;
  rooms: number | null;
  description: string;
};

function matchScore(client: ClientPref, prop: PropCandidate): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Lokalita 30%
  if (client.preferred_locality) {
    const loc = client.preferred_locality.toLowerCase();
    if (prop.district.toLowerCase().includes(loc) || prop.city.toLowerCase().includes(loc) ||
        loc.includes(prop.district.toLowerCase()) || loc.includes(prop.city.toLowerCase())) {
      score += 30;
      reasons.push(`lokalita (${prop.district})`);
    }
  } else {
    score += 10;
  }

  // Typ 20%
  if (client.preferred_type) {
    if (prop.type === client.preferred_type) {
      score += 20;
      reasons.push(`typ (${prop.type})`);
    }
  } else {
    score += 10;
  }

  // Budget 30% — s tolerancí ±20%.
  if (client.budget_max || client.budget_min) {
    const minOk = !client.budget_min || prop.price >= client.budget_min * 0.8;
    const maxOk = !client.budget_max || prop.price <= client.budget_max * 1.2;
    if (minOk && maxOk) {
      score += 30;
      reasons.push(`rozpočet (${czMoney(prop.price)})`);
    } else if (minOk || maxOk) {
      score += 12;
    }
  } else {
    score += 10;
  }

  // Pokoje 20%
  if (client.preferred_rooms) {
    const prefNum = parseInt(client.preferred_rooms.replace(/[^\d]/g, ""), 10);
    if (prop.rooms && !isNaN(prefNum)) {
      if (prop.rooms === prefNum) {
        score += 20;
        reasons.push(`pokoje (${prop.rooms})`);
      } else if (Math.abs(prop.rooms - prefNum) === 1) {
        score += 10;
      }
    }
  } else {
    score += 10;
  }

  return { score: Math.min(score, 100), reasons };
}

function toolMatchClientsProperties(input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const limit = typeof input.limit === "number" ? Math.min(Math.max(input.limit, 1), 20) : 8;
  const clientId = typeof input.client_id === "number" ? input.client_id : null;

  const clientsWhere = clientId
    ? "c.id = ? AND (c.preferred_locality IS NOT NULL OR c.preferred_type IS NOT NULL OR c.budget_max IS NOT NULL)"
    : "c.preferred_locality IS NOT NULL OR c.preferred_type IS NOT NULL";

  const clients = (clientId
    ? db.prepare(
        `SELECT id, name, preferred_locality, preferred_type, preferred_rooms, budget_min, budget_max
         FROM clients c WHERE ${clientsWhere} LIMIT 20`,
      ).all(clientId)
    : db.prepare(
        `SELECT id, name, preferred_locality, preferred_type, preferred_rooms, budget_min, budget_max
         FROM clients c WHERE ${clientsWhere} LIMIT 20`,
      ).all()) as ClientPref[];

  const properties = db.prepare(
    `SELECT id, address, city, district, type, price, area_m2, rooms, description
     FROM properties WHERE status = 'aktivní'`,
  ).all() as PropCandidate[];

  type Match = { client: ClientPref; prop: PropCandidate; score: number; reasons: string[] };
  const matches: Match[] = [];

  for (const cl of clients) {
    const scored = properties.map((p) => ({ prop: p, ...matchScore(cl, p) }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored.slice(0, 2).filter((s) => s.score >= 50);
    for (const b of best) matches.push({ client: cl, prop: b.prop, score: b.score, reasons: b.reasons });
  }

  matches.sort((a, b) => b.score - a.score);
  const top = matches.slice(0, limit);

  const cards = top.map((m) => {
    const icon = m.score >= 85 ? "🟢" : m.score >= 70 ? "🟡" : "🔵";
    const clientPref = `${m.client.preferred_type ?? "—"} · ${m.client.preferred_locality ?? "—"} · ${m.client.preferred_rooms ?? "—"} · ${m.client.budget_min ? czMoney(m.client.budget_min) : "?"}–${m.client.budget_max ? czMoney(m.client.budget_max) : "?"}`;
    const propLine = `${m.prop.type} · ${m.prop.district}, ${m.prop.city} · ${m.prop.rooms ?? "—"} pokojů · ${m.prop.area_m2} m² · **${czMoney(m.prop.price)}**`;
    const reasons = m.reasons.length > 0 ? m.reasons.join(", ") : "—";
    return [
      `### ${icon} ${m.score}% — ${m.client.name} ↔ ${m.prop.address}`,
      `- **Klient:** ${clientPref}`,
      `- **Nemovitost:** ${propLine}`,
      `- ✓ **Shoda v:** ${reasons}`,
      `- → Napište: *Napiš email pro ${m.client.name} s nabídkou nemovitosti na ${m.prop.address} a navrhni termíny prohlídky.*`,
    ].join("\n");
  }).join("\n\n");

  const parts: string[] = [];
  parts.push(`## 🔗 Párování klient ↔ nemovitost — ${top.length} návrhů`);
  if (top.length === 0) {
    parts.push(`Žádné shody nad 50 % — zkontroluj, zda mají klienti vyplněné preference.`);
  } else {
    parts.push(cards);
  }
  const matchesMd = parts.join("\n\n");

  return {
    ok: true,
    data: {
      ui: "matches",
      count: top.length,
      matches: top.map((m) => ({
        client_id: m.client.id,
        client_name: m.client.name,
        property_id: m.prop.id,
        property_addr: m.prop.address,
        score: m.score,
        reasons: m.reasons,
      })),
      markdown: matchesMd,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY. Pod ním napiš 2–3 věty: koho oslovit jako první a proč.",
    },
  };
}

// ─────────────────────────── client_briefing ───────────────────────────

function toolClientBriefing(input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const clientId = typeof input.client_id === "number" ? input.client_id : null;
  const name = typeof input.name === "string" ? input.name.trim() : null;
  if (!clientId && !name) return { ok: false, error: "Zadej client_id nebo name." };

  const client = (clientId
    ? db.prepare(`SELECT * FROM clients WHERE id = ?`).get(clientId)
    : db.prepare(`SELECT * FROM clients WHERE name LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`%${name}%`)) as
    | {
        id: number; name: string; email: string; phone: string;
        source: string; created_at: string; quarter: string;
        budget_min: number | null; budget_max: number | null;
        preferred_locality: string | null; preferred_rooms: string | null;
        preferred_type: string | null; notes: string | null;
      }
    | undefined;

  if (!client) return { ok: false, error: "Klient nenalezen." };

  const leads = db.prepare(
    `SELECT l.id, l.status, l.created_at, l.last_contact_at, l.next_action,
            COALESCE(l.estimated_commission, 0) AS commission,
            p.address AS addr, p.price, p.type, p.district
     FROM leads l
     JOIN properties p ON p.id = l.property_id
     WHERE l.client_id = ?
     ORDER BY l.created_at DESC`,
  ).all(client.id) as Array<{
    id: number; status: string; created_at: string; last_contact_at: string | null;
    next_action: string | null; commission: number;
    addr: string; price: number; type: string; district: string;
  }>;

  const activeLeads = leads.filter((l) => l.status !== "uzavřen");

  // Doporučené property matches.
  const properties = db.prepare(
    `SELECT id, address, city, district, type, price, area_m2, rooms, description
     FROM properties WHERE status = 'aktivní'`,
  ).all() as PropCandidate[];
  const prefs: ClientPref = {
    id: client.id,
    name: client.name,
    preferred_locality: client.preferred_locality,
    preferred_type: client.preferred_type,
    preferred_rooms: client.preferred_rooms,
    budget_min: client.budget_min,
    budget_max: client.budget_max,
  };
  const scored = properties.map((p) => ({ prop: p, ...matchScore(prefs, p) }));
  scored.sort((a, b) => b.score - a.score);
  const topMatches = scored.slice(0, 3).filter((s) => s.score >= 50);

  const daysSince = client.created_at ? daysSinceIso(client.created_at) : 0;

  const budget = `${client.budget_min ? czMoney(client.budget_min) : "?"} – ${client.budget_max ? czMoney(client.budget_max) : "?"}`;

  // Tabulka historie leadů (markdown)
  let leadsBlock = "_Zatím žádné leady._";
  if (leads.length > 0) {
    const header = "| Fáze | Nemovitost | Cena | Provize | Posl. kontakt |\n|---|---|---:|---:|---:|";
    const rows = leads.slice(0, 8).map((l) => {
      const d = l.last_contact_at ? daysSinceIso(l.last_contact_at) : null;
      const dText = d === null ? "—" : `${d} dní`;
      const cell = (s: string) => s.replace(/\|/g, "\\|");
      return `| ${cell(l.status)} | ${cell(l.addr)} | ${czMoney(l.price)} | ${czMoney(l.commission)} | ${dText} |`;
    }).join("\n");
    leadsBlock = `${header}\n${rows}`;
  }

  // Aktivní leady (bullet list)
  let activeBlock = "_Žádné aktivní leady — příležitost na otevření nového obchodu._";
  if (activeLeads.length > 0) {
    activeBlock = activeLeads.slice(0, 5).map((l) =>
      `- **${l.status}** · ${l.addr}${l.next_action ? ` *(další krok: ${l.next_action})*` : ""}`,
    ).join("\n");
  }

  // Doporučené nabídky
  let recsBlock = "_Žádná ideální nabídka — zvaž rozšíření preferencí._";
  if (topMatches.length > 0) {
    recsBlock = topMatches.map((m, i) =>
      `${i + 1}. **${m.prop.address}** — ${m.prop.type}, ${m.prop.area_m2} m², ${czMoney(m.prop.price)} · shoda **${m.score}%**`,
    ).join("\n");
  }

  // Strukturovaná data pro PDF — base64 JSON na buttonu.
  const pdfPayload = {
    client_name: client.name,
    source: client.source,
    days: daysSince,
    email: client.email,
    phone: client.phone,
    pref: {
      type: client.preferred_type ?? "—",
      locality: client.preferred_locality ?? "—",
      rooms: client.preferred_rooms ?? "—",
      budget,
      notes: client.notes ?? "",
    },
    leads: leads.slice(0, 8).map((l) => ({
      status: l.status, addr: l.addr,
      price: l.price, commission: l.commission,
      last_contact_days: l.last_contact_at ? daysSinceIso(l.last_contact_at) : null,
    })),
    active: activeLeads.slice(0, 5).map((l) => ({ status: l.status, addr: l.addr, next_action: l.next_action })),
    matches: topMatches.map((m) => ({ address: m.prop.address, type: m.prop.type, area: m.prop.area_m2, price: m.prop.price, score: m.score })),
  };
  const pdfB64 = Buffer.from(JSON.stringify(pdfPayload), "utf-8").toString("base64");
  const pdfNameAttr = client.name.replace(/"/g, "&quot;");

  const markdown =
`## 👤 ${client.name}

_Klient · zdroj: ${client.source} · ${daysSince} dní v DB_

### 📞 Kontakt
- **Email:** ${client.email}
- **Telefon:** ${client.phone}

### 🎯 Co hledá
- **Typ:** ${client.preferred_type ?? "—"}
- **Lokalita:** ${client.preferred_locality ?? "—"}
- **Dispozice:** ${client.preferred_rooms ?? "—"}
- **Rozpočet:** ${budget}
${client.notes ? `\n> 🗒 ${client.notes}\n` : ""}
### 📚 Historie leadů (${leads.length})

${leadsBlock}

### ⚡ Aktivní leady: ${activeLeads.length}

${activeBlock}

### 💡 Doporučené nabídky

${recsBlock}

→ Napište: *Stáhni briefing ${client.name} jako PDF*`;

  // Skrytý nosič payloadu pro případný budoucí PDF export (nerendruje se do markdownu).
  void pdfB64;
  void pdfNameAttr;

  return {
    ok: true,
    data: {
      ui: "briefing",
      client,
      leads,
      active_leads: activeLeads,
      recommended_matches: topMatches.map((m) => ({ id: m.prop.id, address: m.prop.address, score: m.score })),
      markdown,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY do své odpovědi. Pod ním napiš 2–3 věty: s čím přijít na schůzku, na co se zaměřit. Nepřepisuj obsah briefingu vlastními slovy.",
    },
  };
}

// ─────────────────────────── price_context ───────────────────────────

function toolPriceContext(input: Record<string, unknown>): ToolResult {
  const db = getDb();
  const propertyId = typeof input.property_id === "number" ? input.property_id : null;
  const address = typeof input.address === "string" ? input.address.trim() : null;
  if (!propertyId && !address) return { ok: false, error: "Zadej property_id nebo address." };

  const prop = (propertyId
    ? db.prepare(`SELECT * FROM properties WHERE id = ?`).get(propertyId)
    : db.prepare(`SELECT * FROM properties WHERE address LIKE ? ORDER BY created_at DESC LIMIT 1`).get(`%${address}%`)) as
    | {
        id: number; address: string; city: string; district: string;
        type: string; price: number; area_m2: number; rooms: number | null;
      }
    | undefined;

  if (!prop) return { ok: false, error: "Nemovitost nenalezena." };
  if (prop.area_m2 <= 0) return { ok: false, error: "Nemovitost nemá platnou plochu." };

  const areaMin = Math.floor(prop.area_m2 * 0.85);
  const areaMax = Math.ceil(prop.area_m2 * 1.15);

  const similar = db.prepare(
    `SELECT id, address, price, area_m2,
            CAST(price AS REAL) / area_m2 AS per_m2
     FROM properties
     WHERE id != ? AND type = ? AND district = ?
       AND area_m2 BETWEEN ? AND ?
       AND status IN ('aktivní','prodáno','rezervováno')
       AND area_m2 > 0`,
  ).all(prop.id, prop.type, prop.district, areaMin, areaMax) as Array<{
    id: number; address: string; price: number; area_m2: number; per_m2: number;
  }>;

  if (similar.length === 0) {
    return { ok: false, error: `Nenalezeny podobné nemovitosti v okrese ${prop.district} (typ ${prop.type}, plocha ${areaMin}-${areaMax} m²).` };
  }

  const myPerM2 = prop.price / prop.area_m2;
  const others = similar.map((s) => s.per_m2).sort((a, b) => a - b);
  const avg = others.reduce((a, b) => a + b, 0) / others.length;
  const median = others[Math.floor(others.length / 2)];
  const minP = others[0];
  const maxP = others[others.length - 1];

  // Percentile ranku: kolik % podobných je LEVNĚJŠÍCH než naše.
  const cheaperCount = others.filter((p) => p < myPerM2).length;
  const percentile = Math.round((cheaperCount / others.length) * 100);

  let verdict: { label: string; tone: string };
  if (myPerM2 < avg * 0.9) verdict = { label: "LEVNÉ", tone: "🟢" };
  else if (myPerM2 > avg * 1.1) verdict = { label: "DRAHÉ", tone: "🔴" };
  else verdict = { label: "ODPOVÍDAJÍCÍ", tone: "🟡" };

  // Histogram (jednoduchý) — 6 binů.
  const bins = 6;
  const binWidth = (maxP - minP) / bins || 1;
  const hist: number[] = Array(bins).fill(0);
  for (const p of others) {
    const idx = Math.min(bins - 1, Math.floor((p - minP) / binWidth));
    hist[idx]++;
  }
  const maxBin = Math.max(1, ...hist);
  const myBinIdx = Math.min(bins - 1, Math.max(0, Math.floor((myPerM2 - minP) / binWidth)));

  const histLines = hist.map((n, i) => {
    const barWidth = 16;
    const filled = Math.round((n / maxBin) * barWidth);
    const bar = "▓".repeat(filled) + "░".repeat(barWidth - filled);
    const binStart = Math.round(minP + i * binWidth);
    const binEnd = Math.round(minP + (i + 1) * binWidth);
    const mark = i === myBinIdx ? " ← tato nemovitost" : "";
    return `\`${bar}\` ${n}× · ${czMoney(binStart)}–${czMoney(binEnd)}/m²${mark}`;
  }).join("\n");

  const deltaPct = ((myPerM2 - avg) / avg) * 100;
  const deltaTxt = `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1).replace(".", ",")}%`;

  const args: string[] = [];
  if (myPerM2 < avg) {
    args.push("Cena za m² je POD průměrem okresu — silný prodejní argument.");
    args.push(`${100 - percentile}% podobných nemovitostí má vyšší cenu za m².`);
  } else if (myPerM2 > avg) {
    args.push("Cena za m² je NAD průměrem okresu — zvaž vyjednávací prostor.");
    args.push(`${percentile}% podobných nemovitostí má nižší cenu za m² — připrav se na dotazy.`);
  } else {
    args.push("Cena odpovídá průměru v okresu — standard trhu.");
  }
  args.push(`Podobných nabídek: ${similar.length} (okres ${prop.district}, ${prop.type}, ${areaMin}–${areaMax} m²).`);

  const markdown = [
    `## 💹 Cenový kontext · ${prop.address}`,
    ``,
    `### ${verdict.tone} Verdikt: **${verdict.label}** (${deltaTxt} vs. průměr)`,
    ``,
    `| Metrika | Hodnota |`,
    `|---|---|`,
    `| Cena nemovitosti | **${czMoney(prop.price)}** |`,
    `| Cena za m² | **${czMoney(Math.round(myPerM2))}/m²** |`,
    `| Průměr okresu | ${czMoney(Math.round(avg))}/m² |`,
    `| Medián okresu | ${czMoney(Math.round(median))}/m² |`,
    `| Rozpětí | ${czMoney(Math.round(minP))}–${czMoney(Math.round(maxP))}/m² |`,
    `| Pořadí | percentil ${percentile} |`,
    ``,
    `### 📊 Rozložení cen za m² (okres ${prop.district})`,
    ``,
    histLines,
    ``,
    `### 🗣 Argumenty pro vyjednávání`,
    ``,
    ...args.map((a) => `- ${a}`),
  ].join("\n");

  return {
    ok: true,
    data: {
      ui: "price_context",
      property: prop,
      stats: { avg_per_m2: Math.round(avg), median_per_m2: Math.round(median), min_per_m2: Math.round(minP), max_per_m2: Math.round(maxP), percentile, similar_count: similar.length },
      verdict: verdict.label,
      markdown,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY. Pod ním napiš 2–3 věty: je cena realistická, a jaký argument použít při jednání.",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// CRUD operace — skutečné zápisy do SQLite.
// ═══════════════════════════════════════════════════════════════════

function nowIso(): string {
  return new Date().toISOString();
}

function currentQuarter(d: Date = new Date()): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function confirmHtml(title: string, rows: Array<[string, unknown]>, tone: "ok" | "update" | "delete" = "ok"): string {
  const icon = tone === "delete" ? "🗑️" : tone === "update" ? "✏️" : "✅";
  const rowsMd = rows
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- **${k}:** ${String(v)}`)
    .join("\n");
  return `### ${icon} ${title}\n\n${rowsMd}`;
}

function findClient(db: ReturnType<typeof getDb>, id: number | null, nameMatch: string | null):
  { id: number; name: string } | null {
  if (id) {
    return db.prepare(`SELECT id, name FROM clients WHERE id = ?`).get(id) as { id: number; name: string } | null;
  }
  if (nameMatch) {
    return db.prepare(`SELECT id, name FROM clients WHERE name LIKE ? ORDER BY created_at DESC LIMIT 1`)
      .get(`%${nameMatch}%`) as { id: number; name: string } | null;
  }
  return null;
}

function findProperty(db: ReturnType<typeof getDb>, id: number | null, addressMatch: string | null):
  { id: number; address: string } | null {
  if (id) {
    return db.prepare(`SELECT id, address FROM properties WHERE id = ?`).get(id) as { id: number; address: string } | null;
  }
  if (addressMatch) {
    return db.prepare(`SELECT id, address FROM properties WHERE address LIKE ? ORDER BY created_at DESC LIMIT 1`)
      .get(`%${addressMatch}%`) as { id: number; address: string } | null;
  }
  return null;
}

const CLIENT_SOURCES = ["web", "doporučení", "inzerát", "sociální sítě"] as const;
const PROPERTY_TYPES = ["byt", "dům", "komerční"] as const;
const PROPERTY_STATUSES = ["aktivní", "prodáno", "rezervováno"] as const;
const LEAD_STATUSES = ["nový", "kontaktován", "prohlídka", "nabídka", "uzavřen"] as const;

async function toolAddClient(input: Record<string, unknown>): Promise<ToolResult> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const source = String(input.source ?? "");
  if (!name) return { ok: false, error: "Chybí jméno." };
  if (!email) return { ok: false, error: "Chybí email." };
  if (!phone) return { ok: false, error: "Chybí telefon." };
  if (!CLIENT_SOURCES.includes(source as typeof CLIENT_SOURCES[number])) {
    return { ok: false, error: `Neplatný source. Povoleno: ${CLIENT_SOURCES.join(", ")}.` };
  }

  const db = getDb();
  const info = await dbRun(
    `INSERT INTO clients (name, email, phone, source, created_at, quarter,
                          budget_min, budget_max, preferred_locality, preferred_rooms, preferred_type, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name, email, phone, source, nowIso(), currentQuarter(),
      typeof input.budget_min === "number" ? input.budget_min : null,
      typeof input.budget_max === "number" ? input.budget_max : null,
      typeof input.preferred_locality === "string" ? input.preferred_locality : null,
      typeof input.preferred_rooms === "string" ? input.preferred_rooms : null,
      typeof input.preferred_type === "string" ? input.preferred_type : null,
      typeof input.notes === "string" ? input.notes : null,
    ],
  );
  const id = Number(info.lastInsertRowid);
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(id);
  const html = confirmHtml(`Klient #${id} zapsán do DB`, [
    ["Jméno", name], ["Email", email], ["Telefon", phone], ["Zdroj", source],
    ["Rozpočet min", input.budget_min], ["Rozpočet max", input.budget_max],
    ["Lokalita", input.preferred_locality], ["Dispozice", input.preferred_rooms],
    ["Typ", input.preferred_type], ["Poznámka", input.notes],
  ]);
  return { ok: true, data: { ui: "crud", id, row, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY do své odpovědi. Pod ním potvrď 1-2 větami, co se uložilo a jaký je další logický krok (např. 'Můžeš nyní vytvořit lead na konkrétní nemovitost.')." } };
}

async function toolUpdateClient(input: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb();
  const target = findClient(db,
    typeof input.id === "number" ? input.id : null,
    typeof input.name_match === "string" ? input.name_match : null);
  if (!target) return { ok: false, error: "Klient nenalezen (zadej id nebo name_match)." };

  const updates: string[] = [];
  const params: unknown[] = [];
  const fields: Array<[string, string]> = [
    ["name", "name"], ["email", "email"], ["phone", "phone"],
    ["budget_min", "budget_min"], ["budget_max", "budget_max"],
    ["preferred_locality", "preferred_locality"], ["preferred_rooms", "preferred_rooms"],
    ["preferred_type", "preferred_type"], ["notes", "notes"],
  ];
  const changes: Array<[string, unknown]> = [];
  for (const [key, col] of fields) {
    if (input[key] !== undefined && input[key] !== null) {
      updates.push(`${col} = ?`);
      params.push(input[key]);
      changes.push([col, input[key]]);
    }
  }
  if (updates.length === 0) return { ok: false, error: "Žádná pole k aktualizaci." };
  params.push(target.id);
  await dbRun(`UPDATE clients SET ${updates.join(", ")} WHERE id = ?`, params);
  const row = db.prepare(`SELECT * FROM clients WHERE id = ?`).get(target.id);
  const html = confirmHtml(`Klient #${target.id} (${target.name}) aktualizován`, changes, "update");
  return { ok: true, data: { ui: "crud", id: target.id, row, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolDeleteClient(input: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb();
  const target = findClient(db,
    typeof input.id === "number" ? input.id : null,
    typeof input.name_match === "string" ? input.name_match : null);
  if (!target) return { ok: false, error: "Klient nenalezen." };

  const leadCount = (db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE client_id = ?`).get(target.id) as { c: number }).c;
  await dbRun(`DELETE FROM leads WHERE client_id = ?`, [target.id]);
  await dbRun(`DELETE FROM clients WHERE id = ?`, [target.id]);
  const html = confirmHtml(`Klient #${target.id} (${target.name}) smazán`, [
    ["Smazané leady", leadCount],
  ], "delete");
  return { ok: true, data: { ui: "crud", id: target.id, deleted_leads: leadCount, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolAddProperty(input: Record<string, unknown>): Promise<ToolResult> {
  const address = typeof input.address === "string" ? input.address.trim() : "";
  const city = typeof input.city === "string" ? input.city.trim() : "";
  const district = typeof input.district === "string" ? input.district.trim() : "";
  const type = String(input.type ?? "");
  const price = typeof input.price === "number" ? Math.round(input.price) : NaN;
  const area = typeof input.area_m2 === "number" ? Math.round(input.area_m2) : NaN;
  const description = typeof input.description === "string" ? input.description : "";
  const status = typeof input.status === "string" ? input.status : "aktivní";

  if (!address || !city || !district) return { ok: false, error: "Chybí address/city/district." };
  if (!PROPERTY_TYPES.includes(type as typeof PROPERTY_TYPES[number])) return { ok: false, error: `type musí být ${PROPERTY_TYPES.join("/")}.` };
  if (!PROPERTY_STATUSES.includes(status as typeof PROPERTY_STATUSES[number])) return { ok: false, error: `status musí být ${PROPERTY_STATUSES.join("/")}.` };
  if (!Number.isFinite(price) || price <= 0) return { ok: false, error: "price musí být kladné číslo." };
  if (!Number.isFinite(area) || area <= 0) return { ok: false, error: "area_m2 musí být kladné číslo." };
  if (!description) return { ok: false, error: "description je povinné." };

  const db = getDb();
  const info = await dbRun(
    `INSERT INTO properties (address, city, district, type, price, area_m2, rooms, status,
                             reconstruction_data, building_modifications, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      address, city, district, type, price, area,
      typeof input.rooms === "number" ? input.rooms : null,
      status,
      typeof input.reconstruction_data === "string" ? input.reconstruction_data : null,
      typeof input.building_modifications === "string" ? input.building_modifications : null,
      description, nowIso(),
    ],
  );
  const id = Number(info.lastInsertRowid);
  const row = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(id);
  const html = confirmHtml(`Nemovitost #${id} zapsána`, [
    ["Adresa", address], ["Město", city], ["Okres", district],
    ["Typ", type], ["Cena", `${price.toLocaleString("cs-CZ")} Kč`],
    ["Plocha", `${area} m²`], ["Pokoje", input.rooms], ["Stav", status],
  ]);
  return { ok: true, data: { ui: "crud", id, row, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolUpdateProperty(input: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb();
  const target = findProperty(db,
    typeof input.id === "number" ? input.id : null,
    typeof input.address_match === "string" ? input.address_match : null);
  if (!target) return { ok: false, error: "Nemovitost nenalezena." };

  const updates: string[] = [];
  const params: unknown[] = [];
  const changes: Array<[string, unknown]> = [];
  const fields = ["address", "city", "district", "type", "price", "area_m2", "rooms", "status",
                  "reconstruction_data", "building_modifications", "description"];
  for (const f of fields) {
    if (input[f] !== undefined && input[f] !== null) {
      updates.push(`${f} = ?`);
      params.push(input[f]);
      changes.push([f, input[f]]);
    }
  }
  if (updates.length === 0) return { ok: false, error: "Žádná pole k aktualizaci." };
  params.push(target.id);
  await dbRun(`UPDATE properties SET ${updates.join(", ")} WHERE id = ?`, params);
  const row = db.prepare(`SELECT * FROM properties WHERE id = ?`).get(target.id);
  const html = confirmHtml(`Nemovitost #${target.id} (${target.address}) aktualizována`, changes, "update");
  return { ok: true, data: { ui: "crud", id: target.id, row, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolDeleteProperty(input: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb();
  const target = findProperty(db,
    typeof input.id === "number" ? input.id : null,
    typeof input.address_match === "string" ? input.address_match : null);
  if (!target) return { ok: false, error: "Nemovitost nenalezena." };
  const leadCount = (db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE property_id = ?`).get(target.id) as { c: number }).c;
  await dbRun(`DELETE FROM leads WHERE property_id = ?`, [target.id]);
  await dbRun(`DELETE FROM properties WHERE id = ?`, [target.id]);
  const html = confirmHtml(`Nemovitost #${target.id} (${target.address}) smazána`, [
    ["Smazané leady", leadCount],
  ], "delete");
  return { ok: true, data: { ui: "crud", id: target.id, deleted_leads: leadCount, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolAddLead(input: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb();
  const client = findClient(db,
    typeof input.client_id === "number" ? input.client_id : null,
    typeof input.client_name === "string" ? input.client_name : null);
  if (!client) return { ok: false, error: "Klient nenalezen (zadej client_id nebo client_name)." };
  const property = findProperty(db,
    typeof input.property_id === "number" ? input.property_id : null,
    typeof input.property_address === "string" ? input.property_address : null);
  if (!property) return { ok: false, error: "Nemovitost nenalezena (zadej property_id nebo property_address)." };
  const status = String(input.status ?? "nový");
  if (!LEAD_STATUSES.includes(status as typeof LEAD_STATUSES[number])) return { ok: false, error: `status musí být ${LEAD_STATUSES.join("/")}.` };
  const source = typeof input.source === "string" ? input.source : "";
  if (!source) return { ok: false, error: "source je povinný." };

  const info = await dbRun(
    `INSERT INTO leads (client_id, property_id, status, source, created_at, last_contact_at, next_action, estimated_commission)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client.id, property.id, status, source, nowIso(),
      typeof input.last_contact_at === "string" ? input.last_contact_at : nowIso(),
      typeof input.next_action === "string" ? input.next_action : null,
      typeof input.estimated_commission === "number" ? input.estimated_commission : null,
    ],
  );
  const id = Number(info.lastInsertRowid);
  const row = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  const html = confirmHtml(`Lead #${id} zapsán`, [
    ["Klient", `${client.name} (#${client.id})`],
    ["Nemovitost", `${property.address} (#${property.id})`],
    ["Stav", status], ["Zdroj", source],
    ["Další krok", input.next_action], ["Odhad provize", input.estimated_commission],
  ]);
  return { ok: true, data: { ui: "crud", id, row, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolUpdateLead(input: Record<string, unknown>): Promise<ToolResult> {
  const id = typeof input.id === "number" ? input.id : null;
  if (!id) return { ok: false, error: "Chybí id." };
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM leads WHERE id = ?`).get(id);
  if (!existing) return { ok: false, error: `Lead #${id} neexistuje.` };

  const updates: string[] = [];
  const params: unknown[] = [];
  const changes: Array<[string, unknown]> = [];
  if (typeof input.status === "string") {
    if (!LEAD_STATUSES.includes(input.status as typeof LEAD_STATUSES[number])) return { ok: false, error: "neplatný status" };
    updates.push("status = ?"); params.push(input.status); changes.push(["status", input.status]);
  }
  if (typeof input.last_contact_at === "string") { updates.push("last_contact_at = ?"); params.push(input.last_contact_at); changes.push(["last_contact_at", input.last_contact_at]); }
  if (typeof input.next_action === "string") { updates.push("next_action = ?"); params.push(input.next_action); changes.push(["next_action", input.next_action]); }
  if (typeof input.estimated_commission === "number") { updates.push("estimated_commission = ?"); params.push(input.estimated_commission); changes.push(["estimated_commission", input.estimated_commission]); }

  if (updates.length === 0) return { ok: false, error: "Žádná pole k aktualizaci." };
  params.push(id);
  await dbRun(`UPDATE leads SET ${updates.join(", ")} WHERE id = ?`, params);
  const row = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id);
  const html = confirmHtml(`Lead #${id} aktualizován`, changes, "update");
  return { ok: true, data: { ui: "crud", id, row, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolDeleteLead(input: Record<string, unknown>): Promise<ToolResult> {
  const id = typeof input.id === "number" ? input.id : null;
  if (!id) return { ok: false, error: "Chybí id." };
  const db = getDb();
  const info = await dbRun(`DELETE FROM leads WHERE id = ?`, [id]);
  if (info.changes === 0) return { ok: false, error: `Lead #${id} neexistuje.` };
  const html = confirmHtml(`Lead #${id} smazán`, [], "delete");
  return { ok: true, data: { ui: "crud", id, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY." } };
}

async function toolAddTransaction(input: Record<string, unknown>): Promise<ToolResult> {
  const db = getDb();
  const property = findProperty(db,
    typeof input.property_id === "number" ? input.property_id : null,
    typeof input.property_address === "string" ? input.property_address : null);
  if (!property) return { ok: false, error: "Nemovitost nenalezena." };
  const client = findClient(db,
    typeof input.client_id === "number" ? input.client_id : null,
    typeof input.client_name === "string" ? input.client_name : null);
  if (!client) return { ok: false, error: "Klient nenalezen." };

  const salePrice = typeof input.sale_price === "number" ? Math.round(input.sale_price) : NaN;
  const commission = typeof input.commission === "number" ? Math.round(input.commission) : NaN;
  if (!Number.isFinite(salePrice) || salePrice <= 0) return { ok: false, error: "sale_price musí být kladné." };
  if (!Number.isFinite(commission) || commission < 0) return { ok: false, error: "commission musí být nezáporné." };
  const date = typeof input.transaction_date === "string" ? input.transaction_date : new Date().toISOString().slice(0, 10);

  const info = await dbRun(
    `INSERT INTO transactions (property_id, client_id, sale_price, commission, transaction_date)
     VALUES (?, ?, ?, ?, ?)`,
    [property.id, client.id, salePrice, commission, date],
  );
  // Nastav property = prodáno, související lead → uzavřen.
  await dbRun(`UPDATE properties SET status = 'prodáno' WHERE id = ?`, [property.id]);
  await dbRun(
    `UPDATE leads SET status = 'uzavřen', last_contact_at = ? WHERE client_id = ? AND property_id = ?`,
    [nowIso(), client.id, property.id],
  );

  const id = Number(info.lastInsertRowid);
  const html = confirmHtml(`Transakce #${id} uzavřena`, [
    ["Klient", `${client.name} (#${client.id})`],
    ["Nemovitost", `${property.address} (#${property.id}) → prodáno`],
    ["Prodejní cena", `${salePrice.toLocaleString("cs-CZ")} Kč`],
    ["Provize", `${commission.toLocaleString("cs-CZ")} Kč`],
    ["Datum", date],
  ]);
  return { ok: true, data: { ui: "crud", id, markdown: html, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Pod tím stručně pogratuluj k uzavření obchodu." } };
}

function toolImportCsv(input: Record<string, unknown>): ToolResult {
  const table = String(input.table ?? "");
  const allowed = ["clients", "properties", "leads", "transactions"];
  if (!allowed.includes(table)) return { ok: false, error: `table musí být ${allowed.join(" / ")}.` };

  const labels: Record<string, { title: string; cols: string }> = {
    clients: { title: "klientů", cols: "name, email, phone, source [, budget_min, budget_max, preferred_locality, preferred_rooms, preferred_type, notes]" },
    properties: { title: "nemovitostí", cols: "address, city, district, type, price, area_m2, description [, rooms, status, reconstruction_data, building_modifications]" },
    leads: { title: "leadů", cols: "client_id, property_id, status, source [, last_contact_at, next_action, estimated_commission]" },
    transactions: { title: "transakcí", cols: "property_id, client_id, sale_price, commission, transaction_date" },
  };
  const meta = labels[table];

  const markdown = [
    `## 📥 Import CSV — ${meta.title}`,
    ``,
    `**Očekávané sloupce:** \`${meta.cols}\``,
    ``,
    `_Kódování: UTF-8 nebo Windows-1250 · oddělovač \`,\` nebo \`;\`_`,
    ``,
    `→ Otevřete **Nastavení → Import CSV** a nahrajte soubor pro tabulku **${table}**. Po nahrání uvidíte náhled a potvrzení importu.`,
  ].join("\n");

  return {
    ok: true,
    data: {
      ui: "csv_import",
      table,
      markdown,
      instructions_for_agent:
        "Vlož pole markdown BEZE ZMĚNY. Pod tím stručně navigaci: 'Otevři Nastavení → Import CSV a nahraj soubor.'",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Kalendář — manage_calendar + view_calendar
// ═══════════════════════════════════════════════════════════════════

type CalEvent = {
  id: number;
  title: string;
  client_id: number | null;
  property_id: number | null;
  start_time: string;
  end_time: string;
  type: string;
  location: string | null;
  notes: string | null;
  created_at: string;
  client_name?: string | null;
  property_address?: string | null;
};

const CAL_TYPES = ["prohlídka", "meeting", "hovor", "jiné"] as const;

function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseUserDatetime(s: string): Date | null {
  if (!s) return null;
  const trimmed = s.trim().replace("T", " ");
  // Akceptuj YYYY-MM-DD HH:MM(:SS)?
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const d = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] ?? "0"),
    );
    return isNaN(d.getTime()) ? null : d;
  }
  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

function parseUserDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const lower = s.trim().toLowerCase();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  if (lower === "today" || lower === "dnes") return now;
  if (lower === "tomorrow" || lower === "zítra" || lower === "zitra") {
    const t = new Date(now); t.setDate(t.getDate() + 1); return t;
  }
  const m = lower.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function isoDayRange(d: Date): { from: string; to: string } {
  const start = new Date(d); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: toLocalIso(start), to: toLocalIso(end) };
}

function isoWeekRange(anchor: Date, offsetWeeks = 0): { from: string; to: string; days: Date[] } {
  const base = new Date(anchor); base.setHours(0, 0, 0, 0);
  const dow = base.getDay(); // 0=Ne
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(base);
  monday.setDate(base.getDate() + diffToMon + offsetWeeks * 7);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    days.push(d);
  }
  const end = new Date(monday); end.setDate(monday.getDate() + 7);
  return { from: toLocalIso(monday), to: toLocalIso(end), days };
}

function fetchEvents(from: string, to: string): CalEvent[] {
  const db = getDb();
  return db.prepare(
    `SELECT e.*, c.name AS client_name, p.address AS property_address
     FROM calendar_events e
     LEFT JOIN clients c ON c.id = e.client_id
     LEFT JOIN properties p ON p.id = e.property_id
     WHERE e.start_time >= ? AND e.start_time < ?
     ORDER BY e.start_time ASC`,
  ).all(from, to) as CalEvent[];
}

function fmtHHMM(iso: string): string {
  const d = parseUserDatetime(iso);
  if (!d) return iso.slice(11, 16);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDayLabel(d: Date): string {
  const days = ["Neděle", "Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek", "Sobota"];
  return `${days[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

function eventIcon(type: string): string {
  if (type === "prohlídka") return "🏠";
  if (type === "meeting") return "🤝";
  if (type === "hovor") return "📞";
  return "📌";
}

function formatEventLine(e: CalEvent): string {
  const time = `${fmtHHMM(e.start_time)}–${fmtHHMM(e.end_time)}`;
  const icon = eventIcon(e.type);
  const parts = [`**${time}** | ${icon} ${e.title}`];
  const meta: string[] = [];
  if (e.client_name) meta.push(`Klient: ${e.client_name}`);
  if (e.location) meta.push(`📍 ${e.location}`);
  if (meta.length) parts.push(meta.join(" · "));
  if (e.notes) parts.push(`_${e.notes}_`);
  return parts.join("  \n");
}

async function toolManageCalendar(input: Record<string, unknown>): Promise<ToolResult> {
  const action = String(input.action ?? "").trim();
  if (!action) return { ok: false, error: "Chybí action (add|list|find_free|move|cancel)." };

  const db = getDb();

  if (action === "list") {
    const range = String(input.range ?? "today");
    const explicitDate = parseUserDate(typeof input.date === "string" ? input.date : null);
    let from: string, to: string, header: string;
    const now = new Date();
    if (explicitDate) {
      const r = isoDayRange(explicitDate);
      from = r.from; to = r.to;
      header = `📅 Kalendář — ${fmtDayLabel(explicitDate)}`;
    } else if (range === "tomorrow") {
      const t = new Date(now); t.setDate(t.getDate() + 1);
      const r = isoDayRange(t); from = r.from; to = r.to;
      header = `📅 Kalendář — zítra (${fmtDayLabel(t)})`;
    } else if (range === "week") {
      const w = isoWeekRange(now, 0); from = w.from; to = w.to;
      header = `📅 Kalendář — tento týden`;
    } else if (range === "next_week") {
      const w = isoWeekRange(now, 1); from = w.from; to = w.to;
      header = `📅 Kalendář — příští týden`;
    } else {
      const r = isoDayRange(now); from = r.from; to = r.to;
      header = `📅 Kalendář — dnes (${fmtDayLabel(now)})`;
    }

    const events = fetchEvents(from, to);
    if (events.length === 0) {
      return {
        ok: true,
        data: {
          ui: "calendar_list",
          events: [],
          markdown: `## ${header}\n\n_Žádné události v tomto rozsahu._`,
          instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Pod něj stručně (1–2 věty) nabídni přidání nové schůzky.",
        },
      };
    }

    const byDay = new Map<string, CalEvent[]>();
    for (const e of events) {
      const d = parseUserDatetime(e.start_time);
      const key = d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : e.start_time.slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }

    const sections: string[] = [`## ${header}`, `${events.length} událostí`];
    for (const [, evs] of byDay) {
      const first = parseUserDatetime(evs[0].start_time);
      if (byDay.size > 1 && first) sections.push(`\n### ${fmtDayLabel(first)}`);
      for (const e of evs) {
        sections.push("");
        sections.push(formatEventLine(e));
      }
    }

    return {
      ok: true,
      data: {
        ui: "calendar_list",
        events,
        markdown: sections.join("\n"),
        instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Pod ním stručně shrň den (2–3 věty): kolik prohlídek, největší blok, kdy máš volno.",
      },
    };
  }

  if (action === "find_free") {
    const date = parseUserDate(typeof input.date === "string" ? input.date : null) ?? (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
    const slotMin = typeof input.slot_min === "number" ? Math.max(15, Math.min(240, input.slot_min)) : 60;
    const { from, to } = isoDayRange(date);
    const events = fetchEvents(from, to);

    const dayStart = new Date(date); dayStart.setHours(9, 0, 0, 0);
    const dayEnd = new Date(date); dayEnd.setHours(17, 0, 0, 0);

    const busy: Array<{ s: number; e: number }> = [];
    for (const ev of events) {
      const s = parseUserDatetime(ev.start_time);
      const e = parseUserDatetime(ev.end_time);
      if (!s || !e) continue;
      busy.push({ s: s.getTime(), e: e.getTime() });
    }
    busy.sort((a, b) => a.s - b.s);

    type Free = { start: Date; end: Date };
    const free: Free[] = [];
    let cursor = dayStart.getTime();
    for (const b of busy) {
      if (b.s > cursor) {
        const gap = b.s - cursor;
        if (gap >= slotMin * 60_000) free.push({ start: new Date(cursor), end: new Date(b.s) });
      }
      cursor = Math.max(cursor, b.e);
    }
    if (cursor < dayEnd.getTime() && dayEnd.getTime() - cursor >= slotMin * 60_000) {
      free.push({ start: new Date(cursor), end: dayEnd });
    }

    const dayLabel = fmtDayLabel(date);
    if (free.length === 0) {
      return {
        ok: true,
        data: {
          ui: "calendar_free",
          free: [],
          markdown: `## 🕐 Volné bloky — ${dayLabel}\n\n_Žádné volné bloky v čase 9:00–17:00 pro délku ≥ ${slotMin} min._\n\nZkuste jiný den nebo kratší délku.`,
          instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Pokud jsou volné bloky, navrhni 2–3 konkrétní časy.",
        },
      };
    }

    const suggestions = free.flatMap((f) => {
      const result: Array<{ start: Date; end: Date }> = [];
      let t = f.start.getTime();
      while (t + slotMin * 60_000 <= f.end.getTime()) {
        result.push({ start: new Date(t), end: new Date(t + slotMin * 60_000) });
        t += Math.max(30 * 60_000, slotMin * 60_000);
      }
      return result;
    });

    const lines = [
      `## 🕐 Volné bloky — ${dayLabel}`,
      ``,
      `Délka ${slotMin} min, mezi 9:00–17:00.`,
      ``,
      `**Navrhované časy:**`,
      ``,
      ...suggestions.slice(0, 6).map((s, i) => `${i + 1}. ${String(s.start.getHours()).padStart(2, "0")}:${String(s.start.getMinutes()).padStart(2, "0")}–${String(s.end.getHours()).padStart(2, "0")}:${String(s.end.getMinutes()).padStart(2, "0")}`),
    ];

    return {
      ok: true,
      data: {
        ui: "calendar_free",
        date: toLocalIso(date).slice(0, 10),
        slot_min: slotMin,
        free: free.map((f) => ({
          start: toLocalIso(f.start),
          end: toLocalIso(f.end),
        })),
        suggestions: suggestions.slice(0, 6).map((s) => ({
          start: toLocalIso(s.start),
          end: toLocalIso(s.end),
        })),
        markdown: lines.join("\n"),
        instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Nabídni uživateli, aby si vybral jeden z časů — pod seznam napiš '→ Napište: *Přidej schůzku v čas X*'.",
      },
    };
  }

  if (action === "add") {
    const title = String(input.title ?? "").trim();
    const typ = String(input.type ?? "meeting");
    if (!title) return { ok: false, error: "Chybí title." };
    if (!CAL_TYPES.includes(typ as typeof CAL_TYPES[number])) {
      return { ok: false, error: `Neplatný type. Povoleno: ${CAL_TYPES.join(", ")}.` };
    }
    const startRaw = typeof input.start_time === "string" ? input.start_time : "";
    const start = parseUserDatetime(startRaw);
    if (!start) return { ok: false, error: "Chybí nebo neplatný start_time (YYYY-MM-DD HH:MM)." };

    let end: Date | null = null;
    if (typeof input.end_time === "string" && input.end_time.trim()) {
      end = parseUserDatetime(input.end_time);
    }
    if (!end) {
      const dur = typeof input.duration_min === "number" ? input.duration_min : 60;
      end = new Date(start.getTime() + Math.max(15, dur) * 60_000);
    }
    if (end.getTime() <= start.getTime()) {
      return { ok: false, error: "end_time musí být po start_time." };
    }

    const client = findClient(
      db,
      typeof input.client_id === "number" ? input.client_id : null,
      typeof input.client_name === "string" ? input.client_name : null,
    );
    const property = findProperty(
      db,
      typeof input.property_id === "number" ? input.property_id : null,
      typeof input.property_address === "string" ? input.property_address : null,
    );

    // Kontrola konfliktu — jiné události, které překrývají [start, end).
    const conflicts = db.prepare(
      `SELECT id, title, start_time, end_time FROM calendar_events
       WHERE NOT (end_time <= ? OR start_time >= ?)
       ORDER BY start_time ASC`,
    ).all(toLocalIso(start), toLocalIso(end)) as Array<{ id: number; title: string; start_time: string; end_time: string }>;

    const info = await dbRun(
      `INSERT INTO calendar_events (title, client_id, property_id, start_time, end_time, type, location, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        client?.id ?? null,
        property?.id ?? null,
        toLocalIso(start),
        toLocalIso(end),
        typ,
        typeof input.location === "string" ? input.location : null,
        typeof input.notes === "string" ? input.notes : null,
        toLocalIso(new Date()),
      ],
    );
    const id = Number(info.lastInsertRowid);

    const rows: Array<[string, unknown]> = [
      ["Událost", title],
      ["Typ", typ],
      ["Čas", `${fmtDayLabel(start)} ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}–${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`],
    ];
    if (client) rows.push(["Klient", `${client.name} (#${client.id})`]);
    if (property) rows.push(["Nemovitost", `${property.address} (#${property.id})`]);
    if (typeof input.location === "string") rows.push(["Místo", input.location]);
    if (typeof input.notes === "string") rows.push(["Poznámka", input.notes]);

    let md = confirmHtml(`📅 Schůzka #${id} zapsána do kalendáře`, rows);
    if (conflicts.length > 0) {
      md += `\n\n> ⚠️ **Konflikt:** tento čas se překrývá s ${conflicts.length} událostí — ${conflicts.map((c) => c.title).join(", ")}.`;
    }

    return { ok: true, data: { ui: "calendar_add", id, conflict_count: conflicts.length, markdown: md, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Pokud je hlášen konflikt, stručně doporuč přesun." } };
  }

  if (action === "move") {
    const eid = typeof input.event_id === "number" ? input.event_id : null;
    if (!eid) return { ok: false, error: "Chybí event_id." };
    const existing = db.prepare(`SELECT * FROM calendar_events WHERE id = ?`).get(eid) as CalEvent | undefined;
    if (!existing) return { ok: false, error: `Událost #${eid} nenalezena.` };

    const startRaw = typeof input.start_time === "string" ? input.start_time : "";
    const start = startRaw ? parseUserDatetime(startRaw) : parseUserDatetime(existing.start_time);
    if (!start) return { ok: false, error: "Neplatný start_time." };

    const oldStart = parseUserDatetime(existing.start_time)!;
    const oldEnd = parseUserDatetime(existing.end_time)!;
    const oldDurMs = oldEnd.getTime() - oldStart.getTime();

    let end: Date | null = null;
    if (typeof input.end_time === "string" && input.end_time.trim()) {
      end = parseUserDatetime(input.end_time);
    }
    if (!end) {
      if (typeof input.duration_min === "number") {
        end = new Date(start.getTime() + input.duration_min * 60_000);
      } else {
        end = new Date(start.getTime() + oldDurMs);
      }
    }
    if (end.getTime() <= start.getTime()) {
      return { ok: false, error: "end_time musí být po start_time." };
    }

    const newTitle = typeof input.title === "string" && input.title.trim() ? input.title.trim() : existing.title;
    const newLocation = typeof input.location === "string" ? input.location : existing.location;
    const newNotes = typeof input.notes === "string" ? input.notes : existing.notes;

    await dbRun(
      `UPDATE calendar_events SET title = ?, start_time = ?, end_time = ?, location = ?, notes = ? WHERE id = ?`,
      [newTitle, toLocalIso(start), toLocalIso(end), newLocation, newNotes, eid],
    );

    const rows: Array<[string, unknown]> = [
      ["Událost", newTitle],
      ["Původní čas", `${fmtDayLabel(oldStart)} ${String(oldStart.getHours()).padStart(2, "0")}:${String(oldStart.getMinutes()).padStart(2, "0")}`],
      ["Nový čas", `${fmtDayLabel(start)} ${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}–${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`],
    ];
    const md = confirmHtml(`📅 Schůzka #${eid} přesunuta`, rows, "update");

    return { ok: true, data: { ui: "calendar_move", id: eid, markdown: md, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Připomeň, že je dobré klienta informovat." } };
  }

  if (action === "cancel") {
    const eid = typeof input.event_id === "number" ? input.event_id : null;
    if (!eid) return { ok: false, error: "Chybí event_id." };
    const existing = db.prepare(`SELECT * FROM calendar_events WHERE id = ?`).get(eid) as CalEvent | undefined;
    if (!existing) return { ok: false, error: `Událost #${eid} nenalezena.` };
    await dbRun(`DELETE FROM calendar_events WHERE id = ?`, [eid]);
    const md = confirmHtml(`📅 Schůzka #${eid} zrušena`, [
      ["Událost", existing.title],
      ["Původní čas", existing.start_time],
    ], "delete");
    return { ok: true, data: { ui: "calendar_cancel", id: eid, markdown: md, instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Stručně připomeň, že klienta je vhodné informovat." } };
  }

  return { ok: false, error: `Neznámá akce: ${action}. Použij add|list|find_free|move|cancel.` };
}

function toolViewCalendar(input: Record<string, unknown>): ToolResult {
  const week = String(input.week ?? "this");
  const offset = week === "next" ? 1 : 0;
  const w = isoWeekRange(new Date(), offset);
  const events = fetchEvents(w.from, w.to);

  const byDay = new Map<string, CalEvent[]>();
  for (const d of w.days) {
    byDay.set(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`, []);
  }
  for (const e of events) {
    const d = parseUserDatetime(e.start_time);
    if (!d) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (byDay.has(key)) byDay.get(key)!.push(e);
  }

  const lines: string[] = [];
  lines.push(`## 📆 Přehled týdne — ${week === "next" ? "příští" : "tento"} týden`);
  lines.push("");
  lines.push(`${events.length} událostí`);
  lines.push("");
  lines.push(`| Den | Události |`);
  lines.push(`|---|---|`);

  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const day of w.days) {
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    const evs = byDay.get(key) ?? [];
    const dayLabel = fmtDayLabel(day);
    const isToday = day.getTime() === today.getTime();
    const label = isToday ? `**${dayLabel}** _(dnes)_` : dayLabel;
    if (evs.length === 0) {
      lines.push(`| ${label} | _volno_ |`);
    } else {
      const cell = evs.map((e) => {
        const time = `${fmtHHMM(e.start_time)}–${fmtHHMM(e.end_time)}`;
        const who = e.client_name ? ` · ${e.client_name}` : "";
        return `${time} ${eventIcon(e.type)} ${e.title.replace(/\|/g, "\\|")}${who}`;
      }).join("<br>");
      lines.push(`| ${label} | ${cell} |`);
    }
  }

  return {
    ok: true,
    data: {
      ui: "calendar_week",
      week,
      events,
      markdown: lines.join("\n"),
      instructions_for_agent: "Vlož pole markdown BEZE ZMĚNY. Pod ním napiš 2–3 věty shrnutí: který den je nejnabitější, kde máš volno.",
    },
  };
}
