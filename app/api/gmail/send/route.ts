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

function getEnv(key: string): string {
  return (process.env[key] || readEnvLocal(key) || "").trim();
}

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 6) return "***";
  return `${v.slice(0, 3)}…${v.slice(-3)}`;
}

type SendBody = {
  to?: string;
  subject?: string;
  body?: string;
  user?: string;
  password?: string;
};

export async function GET() {
  const resendKey = getEnv("RESEND_API_KEY");
  const user = getEnv("GMAIL_USER");
  const pass = getEnv("GMAIL_APP_PASSWORD");
  return Response.json({
    hasResend: Boolean(resendKey),
    hasUser: Boolean(user),
    hasPassword: Boolean(pass),
    maskedResend: resendKey ? mask(resendKey) : null,
    maskedUser: user || null,
    maskedPassword: pass ? mask(pass) : null,
    activeProvider: resendKey ? "resend" : (user && pass ? "nodemailer" : "draft"),
  });
}

export async function POST(req: Request) {
  let body: SendBody = {};
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return Response.json({ ok: false, error: "Neplatný JSON." }, { status: 400 });
  }

  const to = (body.to ?? "").trim();
  const subject = (body.subject ?? "").trim();
  const text = (body.body ?? "").trim();
  if (!to || !subject || !text) {
    return Response.json({ ok: false, error: "Chybí to, subject nebo body." }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return Response.json({ ok: false, error: `Neplatný email: ${to}` }, { status: 400 });
  }

  const resendKey = getEnv("RESEND_API_KEY");
  const resendFrom = getEnv("RESEND_FROM") || "Realitka <onboarding@resend.dev>";

  // ── 1. Resend (produkční cesta) ─────────────────────────────────────
  if (resendKey) {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(resendKey);
      const res = await resend.emails.send({
        from: resendFrom,
        to,
        subject,
        text,
      });
      if (res.error) {
        return Response.json({ ok: false, error: `Resend: ${res.error.message}` }, { status: 500 });
      }
      return Response.json({
        ok: true,
        provider: "resend",
        messageId: res.data?.id,
      });
    } catch (err) {
      return Response.json({
        ok: false,
        error: `Resend chyba: ${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 });
    }
  }

  // ── 2. Nodemailer (lokální fallback pro Gmail) ─────────────────────
  const user = (body.user ?? "").trim() || getEnv("GMAIL_USER");
  const pass = (body.password ?? "").trim() || getEnv("GMAIL_APP_PASSWORD");
  if (user && pass) {
    try {
      const nodemailer = (await import("nodemailer")).default;
      const transporter = nodemailer.createTransport({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: { user, pass },
      });
      const info = await transporter.sendMail({ from: user, to, subject, text });
      return Response.json({
        ok: true,
        provider: "nodemailer",
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return Response.json({ ok: false, error: `SMTP chyba: ${msg}` }, { status: 500 });
    }
  }

  // ── 3. Draft-only (žádný provider) ─────────────────────────────────
  return Response.json({
    ok: true,
    provider: "draft",
    draft: true,
    to,
    subject,
    body: text,
    note: "Žádný email provider není nakonfigurován. Nastavte RESEND_API_KEY (doporučeno) nebo GMAIL_USER + GMAIL_APP_PASSWORD.",
  });
}
