export type Provider =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "mistral"
  | "deepseek"
  | "meta";

export type ProviderInfo = {
  label: string;
  storageKey: string;
  envKey: string;
  endpoint: string;
};

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  anthropic: {
    label: "Anthropic",
    storageKey: "apikey_anthropic",
    envKey: "ANTHROPIC_API_KEY",
    endpoint: "https://api.anthropic.com/v1/messages",
  },
  openai: {
    label: "OpenAI",
    storageKey: "apikey_openai",
    envKey: "OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1/chat/completions",
  },
  google: {
    label: "Google",
    storageKey: "apikey_google",
    envKey: "GOOGLE_API_KEY",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/",
  },
  xai: {
    label: "xAI",
    storageKey: "apikey_xai",
    envKey: "XAI_API_KEY",
    endpoint: "https://api.x.ai/v1/chat/completions",
  },
  mistral: {
    label: "Mistral",
    storageKey: "apikey_mistral",
    envKey: "MISTRAL_API_KEY",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
  },
  deepseek: {
    label: "DeepSeek",
    storageKey: "apikey_deepseek",
    envKey: "DEEPSEEK_API_KEY",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
  },
  meta: {
    label: "Together (Meta)",
    storageKey: "apikey_meta",
    envKey: "TOGETHER_API_KEY",
    endpoint: "https://api.together.xyz/v1/chat/completions",
  },
};

export type ModelDef = {
  id: string;
  label: string;
  provider: Provider;
  locked?: boolean;
};

// Speciální pseudo-model: server vybere nejvhodnější model podle dotazu.
export const AUTO_MODEL_ID = "auto";

export const MODELS: ModelDef[] = [
  { id: "claude-opus-4-7-20250415",   label: "Claude Opus 4.7",   provider: "anthropic" },
  { id: "claude-opus-4-6-20250204",   label: "Claude Opus 4.6",   provider: "anthropic" },
  { id: "claude-sonnet-4-6-20260217", label: "Claude Sonnet 4.6", provider: "anthropic" },
  { id: "claude-haiku-4-5-20251001",  label: "Claude Haiku 4.5",  provider: "anthropic" },

  { id: "gpt-5.4",                     label: "GPT-5.4",          provider: "openai",   locked: true },
  { id: "gpt-5.4-thinking",            label: "GPT-5.4 Thinking", provider: "openai",   locked: true },
  { id: "gemini-3.1-pro",              label: "Gemini 3.1 Pro",   provider: "google",   locked: true },
  { id: "gemini-3.1-ultra",            label: "Gemini 3.1 Ultra", provider: "google",   locked: true },
  { id: "grok-4-20",                   label: "Grok 4.20",        provider: "xai",      locked: true },
  { id: "mistral-small-4",             label: "Mistral Small 4",  provider: "mistral",  locked: true },
  { id: "deepseek-chat",               label: "DeepSeek V3",      provider: "deepseek", locked: true },
  { id: "meta-llama/Llama-4-Maverick", label: "Llama 4 Maverick", provider: "meta",     locked: true },
];

export const DEFAULT_MODEL_ID = AUTO_MODEL_ID;

export function findModel(id: string): ModelDef | undefined {
  return MODELS.find((m) => m.id === id);
}

// Aliasing: uživatelem zadané ID → skutečné API ID Anthropicu (stabilní aliasy).
export const ANTHROPIC_MODEL_ALIASES: Record<string, string> = {
  "claude-opus-4-7-20250415":   "claude-opus-4-7",
  "claude-opus-4-6-20250204":   "claude-opus-4-6",
  "claude-sonnet-4-6-20260217": "claude-sonnet-4-6",
};

export function resolveAnthropicModelId(id: string): string {
  return ANTHROPIC_MODEL_ALIASES[id] ?? id;
}

// Barvy a iniciály pro ikonu providera v UI.
export const PROVIDER_COLORS: Record<Provider, string> = {
  anthropic: "#d97706",
  openai:    "#10a37f",
  google:    "#4285F4",
  xai:       "#111111",
  mistral:   "#fa520f",
  deepseek:  "#6266f1",
  meta:      "#0081fb",
};

export const PROVIDER_INITIAL: Record<Provider, string> = {
  anthropic: "A",
  openai:    "O",
  google:    "G",
  xai:       "x",
  mistral:   "M",
  deepseek:  "D",
  meta:      "T",
};
