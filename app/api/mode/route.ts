import { NextResponse } from "next/server";
import { enterTestMode, exitTestMode, getDbMode, ensureLocalReady } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureLocalReady();
    const mode = await getDbMode();
    return NextResponse.json({ ok: true, mode });
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
    await ensureLocalReady();
    if (action === "enter_test") {
      const r = await enterTestMode();
      return NextResponse.json({ ok: true, mode: await getDbMode(), copied: r.copied });
    }
    if (action === "exit_test_discard") {
      await exitTestMode("discard");
      return NextResponse.json({ ok: true, mode: await getDbMode() });
    }
    if (action === "exit_test_commit") {
      await exitTestMode("commit");
      return NextResponse.json({ ok: true, mode: await getDbMode() });
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
