import Anthropic from "@anthropic-ai/sdk";

export const ROUTER_MODEL = "claude-haiku-4-5-20251001";

export function buildRouterSystemPrompt(availableIds: string[]): string {
  return `Jsi router. Analyzuj dotaz a vyber nejlepší DOSTUPNÝ model.
Odpověz PŘESNĚ ve dvou řádcích:
MODEL: <API-id jednoho z dostupných modelů>
REASON: <1 krátká česká věta — proč jsi vybral tento model>

Dostupné modely: ${availableIds.join(", ")}

Pravidla (rozhodni se podle povahy dotazu):
- Jednoduchý faktický dotaz, vyhledání v databázi (COUNT, SELECT), krátká odpověď → nejrychlejší: claude-haiku-4-5-20251001 nebo deepseek-chat
- SQL analytika, grafy, tabulky, datová analýza → claude-sonnet-4-6-20260217 nebo gpt-5.4
- Komplexní strategie, prezentace, hluboká analýza, architektura → claude-opus-4-7-20250415 nebo claude-opus-4-6-20250204 nebo gemini-3.1-ultra
- Psaní emailů, reportů, kreativní text → claude-sonnet-4-6-20260217 nebo claude-opus-4-6-20250204
- Matematika, vědecké výpočty, reasoning → gemini-3.1-ultra nebo gpt-5.4-thinking
- Real-time data, aktuální informace → grok-4-20
- Kódování, debugging → claude-sonnet-4-6-20260217 nebo gpt-5.4
- Finanční modelování, právní analýza → gpt-5.4 nebo claude-opus-4-7-20250415
- Pokud je dotaz v češtině a nejsou dostupné jiné modely, preferuj Claude modely

DŮLEŽITÉ: Vrácené MODEL musí být PŘESNĚ jedno z Dostupných modelů výše.`;
}

export type RouterDecision = {
  modelId: string;
  reason: string;
  rawResponse: string;
  matchKind: "exact" | "fallback-pref" | "first-available";
  availableIds: string[];
  userMessagePreview: string;
};

// Zavolá Haiku jako router a vrátí ID vybraného dostupného modelu + důvod.
export async function routeAuto(
  anthropicKey: string,
  lastUserMessage: string,
  availableIds: string[]
): Promise<RouterDecision> {
  if (availableIds.length === 0) {
    throw new Error("Žádný model není dostupný. Přidej API klíč v /settings.");
  }

  const preview = lastUserMessage.slice(0, 120);

  if (availableIds.length === 1) {
    const onlyId = availableIds[0];
    const decision: RouterDecision = {
      modelId: onlyId,
      reason: "Pouze jeden dostupný model — routing přeskočen.",
      rawResponse: "(router nezavolán)",
      matchKind: "first-available",
      availableIds,
      userMessagePreview: preview,
    };
    logRouterDecision(decision);
    return decision;
  }

  const client = new Anthropic({ apiKey: anthropicKey });
  const resp = await client.messages.create({
    model: ROUTER_MODEL,
    max_tokens: 200,
    system: buildRouterSystemPrompt(availableIds),
    messages: [{ role: "user", content: lastUserMessage.slice(0, 4000) }],
  });
  const txt = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  const modelMatch = txt.match(/MODEL\s*:\s*([^\s\n]+)/i);
  const reasonMatch = txt.match(/REASON\s*:\s*(.+?)(?:\n|$)/i);
  const proposedId = modelMatch?.[1]?.trim() ?? "";
  const reason = reasonMatch?.[1]?.trim() ?? "(router neposkytl zdůvodnění)";

  // 1. Přesný match navrženého ID vůči dostupným.
  if (proposedId && availableIds.includes(proposedId)) {
    const decision: RouterDecision = {
      modelId: proposedId,
      reason,
      rawResponse: txt,
      matchKind: "exact",
      availableIds,
      userMessagePreview: preview,
    };
    logRouterDecision(decision);
    return decision;
  }

  // 2. Substring match — router mohl vrátit ID uvnitř většího textu.
  for (const id of availableIds) {
    if (txt.includes(id)) {
      const decision: RouterDecision = {
        modelId: id,
        reason,
        rawResponse: txt,
        matchKind: "exact",
        availableIds,
        userMessagePreview: preview,
      };
      logRouterDecision(decision);
      return decision;
    }
  }

  // 3. Fallback preference: Sonnet → Opus 4.7 → Opus 4.6 → Haiku → první dostupný.
  const prefs = [
    "claude-sonnet-4-6-20260217",
    "claude-opus-4-7-20250415",
    "claude-opus-4-6-20250204",
    "claude-haiku-4-5-20251001",
  ];
  for (const p of prefs) {
    if (availableIds.includes(p)) {
      const decision: RouterDecision = {
        modelId: p,
        reason: `Router nevrátil validní ID — fallback preference (${p}).`,
        rawResponse: txt,
        matchKind: "fallback-pref",
        availableIds,
        userMessagePreview: preview,
      };
      logRouterDecision(decision);
      return decision;
    }
  }

  const decision: RouterDecision = {
    modelId: availableIds[0],
    reason: "Žádná preference neodpovídá — první dostupný.",
    rawResponse: txt,
    matchKind: "first-available",
    availableIds,
    userMessagePreview: preview,
  };
  logRouterDecision(decision);
  return decision;
}

function logRouterDecision(d: RouterDecision): void {
  console.log("━".repeat(70));
  console.log("🧭 [AUTO-ROUTER] rozhodnutí");
  console.log("   Dotaz:       ", JSON.stringify(d.userMessagePreview));
  console.log("   Dostupné:    ", d.availableIds.join(", "));
  console.log("   Router model:", ROUTER_MODEL);
  console.log("   Raw odpověď: ", d.rawResponse.replace(/\n/g, " | "));
  console.log("   Vybraný:     ", d.modelId);
  console.log("   Match typ:   ", d.matchKind);
  console.log("   Důvod:       ", d.reason);
  console.log("━".repeat(70));
}
