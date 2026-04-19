# Realitka — Back Office Operations Agent

AI asistent nad SQLite databází české realitní kanceláře. Next.js 14 (App Router) + TypeScript + TailwindCSS + Claude API s tool use a streamingem.

## Rychlý start

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev
```

Otevři `http://localhost:3000`. Databáze se při prvním načtení **automaticky naseedí** (50 klientů, 100 nemovitostí, 200 leadů, 30 transakcí). Ruční seed: `npm run seed`.

## Co agent umí

5 nástrojů, které volá sám podle potřeby:

| Nástroj | Účel |
|---|---|
| `query_database` | Read-only SELECT nad SQLite |
| `search_properties` | Filtrované vyhledání nemovitostí |
| `find_missing_data` | Nemovitosti s chybějícími poli |
| `generate_chart` | QuickChart.io URL (inline obrázek) |
| `generate_report` | Strukturovaný markdown report |

Model: `claude-sonnet-4-6`. Streaming přes SSE + `ReadableStream`.

## Struktura

- `app/page.tsx` — chat UI (tmavý design ve stylu Claude.ai)
- `app/api/chat/route.ts` — streaming endpoint s agent smyčkou
- `app/api/init/route.ts` — auto-seed při prvním requestu
- `lib/db.ts` — SQLite connection + schéma
- `lib/seed.ts` — české mock data
- `lib/tools.ts` — definice a implementace nástrojů
- `lib/systemPrompt.ts` — system prompt agenta
- `components/*` — Sidebar, ChatMessage, QuickActions, ToolBadge, Markdown

## Deployment

Build funguje na Vercelu. Pro produkci používá SQLite v `data/realitka.db` — na Vercelu je filesystem read-only, takže pro ostré nasazení vyměň za Turso/Neon nebo použij `:memory:` s reseedem při startu.
