import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readEnvLocal(key: string): string | null {
  try {
    const envPath = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(envPath)) return null;
    const contents = fs.readFileSync(envPath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`));
      if (m) {
        const val = m[1].replace(/^['"]|['"]$/g, "").trim();
        if (val) return val;
      }
    }
  } catch {}
  return null;
}

function maskKey(k: string): string {
  if (k.length <= 12) return "***";
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

// Vrátí pouze info, že klíč existuje + maskovaný ukazatel pro UI.
// Plný klíč nikdy nevyleze na klienta.
export async function GET() {
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  const key = fromEnv || readEnvLocal("ANTHROPIC_API_KEY");
  if (!key) {
    return Response.json({ hasKey: false, masked: null });
  }
  return Response.json({ hasKey: true, masked: maskKey(key) });
}
