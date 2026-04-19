"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentForm } from "@/components/AgentForm";
import {
  loadAgents,
  loadActiveAgentId,
  saveActiveAgentId,
  saveAgents,
  type Agent,
} from "@/lib/agents";
import { PROVIDERS, type Provider } from "@/lib/models";

export default function EditAgentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [missing, setMissing] = useState(false);
  const [unlocked, setUnlocked] = useState<Set<Provider>>(new Set(["anthropic"]));

  useEffect(() => {
    if (!id) return;
    const all = loadAgents();
    const found = all.find((a) => a.id === id);
    if (!found) setMissing(true);
    else setAgent(found);

    const s = new Set<Provider>();
    for (const p of Object.keys(PROVIDERS) as Provider[]) {
      const v = localStorage.getItem(PROVIDERS[p].storageKey);
      if (v && v.trim()) s.add(p);
    }
    fetch("/api/anthropic-key")
      .then((r) => r.json())
      .then((info) => {
        if (info?.hasKey) s.add("anthropic");
        setUnlocked(new Set(s));
      })
      .catch(() => setUnlocked(new Set(s)));
  }, [id]);

  const save = (next: Agent) => {
    const all = loadAgents().map((a) => (a.id === next.id ? next : a));
    saveAgents(all);
    router.push("/");
  };

  const remove = () => {
    if (!agent) return;
    if (!confirm(`Smazat agenta "${agent.name}"? Tato akce je nevratná.`)) return;
    const all = loadAgents().filter((a) => a.id !== agent.id);
    saveAgents(all);
    if (loadActiveAgentId() === agent.id) saveActiveAgentId(null);
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">
              {agent ? `Upravit: ${agent.name}` : missing ? "Agent nenalezen" : "Upravit agenta"}
            </h1>
            <p className="text-xs text-text-dim">Změny se uloží do prohlížeče (localStorage)</p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-border bg-bg-panel px-3 py-1.5 text-xs text-text hover:border-accent hover:bg-bg-hover"
          >
            ← Zpět do chatu
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-8">
        {missing && (
          <div className="rounded-lg border border-border bg-bg-panel p-6 text-sm text-text-muted">
            Agent s ID <code>{id}</code> neexistuje.
          </div>
        )}
        {agent && (
          <AgentForm
            initial={agent}
            mode="edit"
            unlockedProviders={unlocked}
            onSave={save}
            onCancel={() => router.push("/")}
            onDelete={remove}
          />
        )}
      </main>
    </div>
  );
}
