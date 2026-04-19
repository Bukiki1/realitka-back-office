"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AgentForm } from "@/components/AgentForm";
import {
  loadAgents,
  newAgentId,
  saveAgents,
  saveActiveAgentId,
  type Agent,
} from "@/lib/agents";
import { AUTO_MODEL_ID, PROVIDERS, type Provider } from "@/lib/models";

export default function NewAgentPage() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState<Set<Provider>>(new Set(["anthropic"]));

  useEffect(() => {
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
  }, []);

  const empty: Agent = {
    id: newAgentId(),
    name: "",
    icon: "🤖",
    color: "#2563eb",
    systemPrompt: "",
    preferredModel: AUTO_MODEL_ID,
    allowedTools: [],
  };

  const save = (agent: Agent) => {
    const all = loadAgents();
    saveAgents([...all, agent]);
    saveActiveAgentId(agent.id);
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-bg text-text">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-white">Nový agent</h1>
            <p className="text-xs text-text-dim">Definuj chování, nástroje a preferovaný model</p>
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
        <AgentForm
          initial={empty}
          mode="create"
          unlockedProviders={unlocked}
          onSave={save}
          onCancel={() => router.push("/")}
        />
      </main>
    </div>
  );
}
