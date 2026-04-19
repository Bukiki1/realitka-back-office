import { NextResponse } from "next/server";
import { enterTestMode, exitTestMode, getDbMode, initSchema } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, mode: getDbMode() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const action = String(body.action ?? "");
  try {
    if (action === "enter_test") {
      const r = enterTestMode();
      initSchema();
      return NextResponse.json({ ok: true, mode: getDbMode(), copied: r.copied });
    }
    if (action === "exit_test_discard") {
      exitTestMode("discard");
      initSchema();
      return NextResponse.json({ ok: true, mode: getDbMode() });
    }
    if (action === "exit_test_commit") {
      exitTestMode("commit");
      initSchema();
      return NextResponse.json({ ok: true, mode: getDbMode() });
    }
    return NextResponse.json(
      { ok: false, error: "action musí být enter_test / exit_test_discard / exit_test_commit." },
      { status: 400 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
