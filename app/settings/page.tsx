"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PROVIDERS, type Provider } from "@/lib/models";
import { ProviderIcon } from "@/components/ProviderIcon";

const PROVIDER_ORDER: Provider[] = [
  "anthropic",
  "openai",
  "google",
  "xai",
  "mistral",
  "deepseek",
  "meta",
];

const KEY_HINT: Record<Provider, string> = {
  anthropic: "sk-ant-…",
  openai:    "sk-…",
  google:    "AIza…",
  xai:       "xai-…",
  mistral:   "API klíč Mistral",
  deepseek:  "API klíč DeepSeek",
  meta:      "API klíč Together.ai (pro Llamu)",
};

const EDITABLE: Record<Provider, boolean> = {
  anthropic: false, // .env.local je zdroj pravdy
  openai: true, google: true, xai: true, mistral: true, deepseek: true, meta: true,
};

type AnthropicInfo = { hasKey: boolean; masked: string | null };
type GmailInfo = {
  hasUser: boolean;
  hasPassword: boolean;
  maskedUser: string | null;
  maskedPassword: string | null;
};

export default function SettingsPage() {
  const [values, setValues] = useState<Record<Provider, string>>({
    anthropic: "", openai: "", google: "", xai: "", mistral: "", deepseek: "", meta: "",
  });
  const [revealed, setRevealed] = useState<Record<Provider, boolean>>({
    anthropic: false, openai: false, google: false, xai: false, mistral: false, deepseek: false, meta: false,
  });
  const [anthropicInfo, setAnthropicInfo] = useState<AnthropicInfo>({ hasKey: false, masked: null });
  const [saved, setSaved] = useState(false);
  const [gmailUser, setGmailUser] = useState("");
  const [gmailPass, setGmailPass] = useState("");
  const [gmailRevealPass, setGmailRevealPass] = useState(false);
  const [gmailServerInfo, setGmailServerInfo] = useState<GmailInfo>({
    hasUser: false, hasPassword: false, maskedUser: null, maskedPassword: null,
  });
  const [gmailTestResult, setGmailTestResult] = useState<string | null>(null);
  const [gmailTesting, setGmailTesting] = useState(false);
  const [clearStatus, setClearStatus] = useState<string | null>(null);
  const [clearBusy, setClearBusy] = useState(false);

  useEffect(() => {
    const next = { ...values };
    for (const p of PROVIDER_ORDER) {
      if (!EDITABLE[p]) continue;
      const v = localStorage.getItem(PROVIDERS[p].storageKey);
      if (v) next[p] = v;
    }
    setValues(next);

    fetch("/api/anthropic-key")
      .then((r) => r.json())
      .then((info: AnthropicInfo) => setAnthropicInfo(info))
      .catch(() => {});

    setGmailUser(localStorage.getItem("gmail_user") || "");
    setGmailPass(localStorage.getItem("gmail_app_password") || "");
    fetch("/api/gmail/send")
      .then((r) => r.json())
      .then((info: GmailInfo) => setGmailServerInfo(info))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    for (const p of PROVIDER_ORDER) {
      if (!EDITABLE[p]) continue;
      const v = values[p].trim();
      if (v) localStorage.setItem(PROVIDERS[p].storageKey, v);
      else localStorage.removeItem(PROVIDERS[p].storageKey);
    }
    const gu = gmailUser.trim();
    const gp = gmailPass.trim();
    if (gu) localStorage.setItem("gmail_user", gu);
    else localStorage.removeItem("gmail_user");
    if (gp) localStorage.setItem("gmail_app_password", gp);
    else localStorage.removeItem("gmail_app_password");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const clearOne = (p: Provider) => {
    localStorage.removeItem(PROVIDERS[p].storageKey);
    setValues((prev) => ({ ...prev, [p]: "" }));
  };

  const testGmail = async () => {
    const to = window.prompt("Zadejte testovací emailovou adresu (na vás):", gmailUser || "");
    if (!to) return;
    setGmailTesting(true);
    setGmailTestResult(null);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: "Realitka Agent — testovací email",
          body: "Tento email je testovací zpráva z Realitka Back Office Agenta. Pokud jej čtete, Gmail integrace funguje správně.",
          user: gmailUser.trim() || undefined,
          password: gmailPass.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setGmailTestResult(`✓ Odesláno na ${to} (ID: ${data.messageId ?? "—"})`);
      } else {
        setGmailTestResult(`✗ Chyba: ${data.error || `HTTP ${res.status}`}`);
      }
    } catch (err) {
      setGmailTestResult(`✗ Síťová chyba: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGmailTesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Nastavení</h1>
            <p className="text-xs text-text-dim">API klíče pro jednotlivé poskytovatele</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/import"
              className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-bg-hover"
            >
              📥 Import dat
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-bg-hover"
            >
              ← Zpět do chatu
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 rounded-lg border border-border bg-bg-panel p-4 text-xs text-text-muted">
          Klíče se ukládají výhradně ve vašem prohlížeči (localStorage) a posílají se na server
          pouze při volání konkrétního modelu. Po uložení klíče se modely odpovídajícího poskytovatele
          automaticky odemknou v přepínači. Anthropic klíč je načten ze souboru{" "}
          <code className="rounded bg-bg px-1">.env.local</code> a nejde měnit z prohlížeče.
        </div>

        <div className="space-y-4">
          {PROVIDER_ORDER.map((p) => {
            const info = PROVIDERS[p];
            const editable = EDITABLE[p];
            const isAnthropic = p === "anthropic";
            const displayValue = isAnthropic
              ? anthropicInfo.hasKey
                ? anthropicInfo.masked ?? "***"
                : ""
              : values[p];

            return (
              <div key={p} className="rounded-lg border border-border bg-bg-sidebar p-4">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-white">
                    <ProviderIcon provider={p} size={14} />
                    {info.label}
                    {isAnthropic && (
                      <span className="rounded bg-bg-panel px-1.5 py-0.5 text-[10px] font-normal text-text-dim">
                        z .env.local
                      </span>
                    )}
                  </label>
                  <span className="text-[11px] text-text-dim">{KEY_HINT[p]}</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type={revealed[p] ? "text" : "password"}
                    value={displayValue}
                    onChange={(e) =>
                      editable && setValues((prev) => ({ ...prev, [p]: e.target.value }))
                    }
                    disabled={!editable}
                    placeholder={
                      isAnthropic
                        ? anthropicInfo.hasKey
                          ? ""
                          : "ANTHROPIC_API_KEY není v .env.local"
                        : `API klíč pro ${info.label}`
                    }
                    className={`flex-1 rounded-lg border border-border px-3 py-2 text-sm placeholder:text-text-dim focus:border-accent focus:outline-none ${
                      editable ? "bg-bg text-text" : "bg-bg-panel text-text-muted"
                    }`}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {editable && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRevealed((prev) => ({ ...prev, [p]: !prev[p] }))}
                        className="rounded-lg border border-border bg-bg-panel px-3 text-xs text-text hover:border-accent"
                        aria-label={revealed[p] ? "Skrýt" : "Zobrazit"}
                      >
                        {revealed[p] ? "Skrýt" : "Ukázat"}
                      </button>
                      {values[p] && (
                        <button
                          type="button"
                          onClick={() => clearOne(p)}
                          className="rounded-lg border border-border bg-bg-panel px-3 text-xs text-text-muted hover:border-red-400 hover:text-red-400"
                        >
                          Smazat
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="mt-2 text-[11px] text-text-dim">
                  Endpoint: <code className="text-text-muted">{info.endpoint}</code>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 rounded-lg border border-border bg-bg-sidebar p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <span>📧</span> Gmail (odesílání emailů)
            </h2>
            {gmailServerInfo.hasUser && gmailServerInfo.hasPassword ? (
              <span className="rounded bg-green-950/60 px-2 py-0.5 text-[10px] text-green-300">
                .env.local nakonfigurováno
              </span>
            ) : (
              <span className="rounded bg-bg-panel px-2 py-0.5 text-[10px] text-text-dim">
                žádné .env hodnoty
              </span>
            )}
          </div>

          <p className="mb-3 text-[11px] leading-relaxed text-text-muted">
            Pro odesílání emailů přes nástroj <code className="rounded bg-bg px-1">send_email</code> (SMTP Gmail) zadejte vaši Gmail adresu a
            <strong className="text-text"> App Password</strong> (ne běžné heslo). App Password vytvoříte v Google účtu:
            {" "}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              myaccount.google.com/apppasswords
            </a>
            . Vyžaduje zapnuté 2FA. Hodnoty lze uložit buď do tohoto prohlížeče (localStorage), nebo do
            {" "}<code className="rounded bg-bg px-1">.env.local</code> jako
            {" "}<code className="rounded bg-bg px-1">GMAIL_USER</code> a
            {" "}<code className="rounded bg-bg px-1">GMAIL_APP_PASSWORD</code>.
          </p>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white">
                Gmail adresa (GMAIL_USER)
              </label>
              <input
                type="email"
                value={gmailUser}
                onChange={(e) => setGmailUser(e.target.value)}
                placeholder={gmailServerInfo.maskedUser ?? "vas.email@gmail.com"}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-white">
                App Password (GMAIL_APP_PASSWORD)
              </label>
              <div className="flex gap-2">
                <input
                  type={gmailRevealPass ? "text" : "password"}
                  value={gmailPass}
                  onChange={(e) => setGmailPass(e.target.value)}
                  placeholder={gmailServerInfo.maskedPassword ?? "xxxx xxxx xxxx xxxx"}
                  className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-text-dim focus:border-accent focus:outline-none"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setGmailRevealPass((v) => !v)}
                  className="rounded-lg border border-border bg-bg-panel px-3 text-xs text-text hover:border-accent"
                >
                  {gmailRevealPass ? "Skrýt" : "Ukázat"}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-text-dim">
                16místný App Password (mezery povoleny). SMTP: smtp.gmail.com:587 (STARTTLS).
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={testGmail}
                disabled={gmailTesting}
                className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent disabled:opacity-50"
              >
                {gmailTesting ? "Odesílám…" : "Poslat testovací email"}
              </button>
              {gmailTestResult && (
                <span className={`text-[11px] ${gmailTestResult.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>
                  {gmailTestResult}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="text-xs text-text-dim">
            {saved ? <span className="text-green-400">Uloženo.</span> : <span>&nbsp;</span>}
          </div>
          <button
            type="button"
            onClick={save}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Uložit klíče
          </button>
        </div>

        <div className="mt-8 rounded-xl border border-border bg-bg-panel p-5">
          <h2 className="mb-1 text-sm font-semibold text-white">Data</h2>
          <p className="mb-4 text-xs text-text-dim">
            Export kompletní databáze nebo jednotlivých tabulek. Promazání demo dat připraví instanci pro reálné nasazení.
          </p>

          <div className="mb-4">
            <div className="mb-1 text-xs font-medium text-white">Export všech dat</div>
            <a
              href="/api/export/json"
              className="inline-block rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text hover:border-accent"
            >
              ⬇ Stáhnout jako JSON
            </a>
          </div>

          <div className="mb-4">
            <div className="mb-1 text-xs font-medium text-white">Export tabulek (CSV)</div>
            <div className="flex flex-wrap gap-2">
              {(["clients", "properties", "leads", "transactions"] as const).map((t) => (
                <a
                  key={t}
                  href={`/api/export/csv?table=${t}`}
                  className="rounded-lg border border-border bg-bg px-3 py-1.5 text-xs text-text hover:border-accent"
                >
                  ⬇ {t}.csv
                </a>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-text-dim">UTF-8 s BOM — Excel otevře s diakritikou.</p>
          </div>

          <div>
            <div className="mb-1 text-xs font-medium text-red-400">Nebezpečná zóna</div>
            <button
              type="button"
              disabled={clearBusy}
              onClick={async () => {
                const ok1 = window.confirm(
                  "Opravdu chcete SMAZAT VŠECHNA data (klienty, nemovitosti, leady, transakce)? Tato akce je nevratná.",
                );
                if (!ok1) return;
                const typed = window.prompt("Napište SMAZAT pro potvrzení:");
                if (typed !== "SMAZAT") {
                  setClearStatus("Zrušeno.");
                  return;
                }
                setClearBusy(true);
                setClearStatus("Mažu…");
                try {
                  const res = await fetch("/api/data/clear", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirm: "SMAZAT" }),
                  });
                  const data = await res.json();
                  if (res.ok && data.ok) {
                    setClearStatus(`✓ Smazáno: klienti=${data.cleared.clients}, nemovitosti=${data.cleared.properties}, leady=${data.cleared.leads}, transakce=${data.cleared.transactions}.`);
                  } else {
                    setClearStatus(`Chyba: ${data.error ?? res.status}`);
                  }
                } catch (err) {
                  setClearStatus(`Síťová chyba: ${err instanceof Error ? err.message : String(err)}`);
                } finally {
                  setClearBusy(false);
                }
              }}
              className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
            >
              🗑️ Smazat všechna demo data
            </button>
            {clearStatus && (
              <div className={`mt-2 text-[11px] ${clearStatus.startsWith("✓") ? "text-green-400" : "text-text-dim"}`}>
                {clearStatus}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
