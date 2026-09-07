import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * ONE-TIME migration: update triggers to pass sociedad_id to generate_document_number.
 * DELETE THIS FILE after running once.
 *
 * GET /api/migrate-numeracion?key=lazzari2026
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("key") !== "lazzari2026") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "no service role key" }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const results: string[] = [];

  try {
    // 1. Check current state of numeracion_secuencias
    const { data: seqs, error: seqErr } = await supabase
      .from("numeracion_secuencias")
      .select("*");
    results.push(`Current sequences: ${JSON.stringify(seqs)}`);
    if (seqErr) results.push(`Seq error: ${seqErr.message}`);

    // 2. Add sociedad_id column if not exists
    const { error: e1 } = await supabase.rpc("exec_sql" as any, {
      sql: `ALTER TABLE numeracion_secuencias ADD COLUMN IF NOT EXISTS sociedad_id UUID;`
    });
    if (e1) {
      // Try direct SQL via postgrest - this won't work, need a different approach
      results.push(`ALTER TABLE error (expected if exec_sql doesn't exist): ${e1.message}`);
    } else {
      results.push("Added sociedad_id column");
    }

    // 3. Get current max PR numbers per sociedad
    const { data: lazzariPRs } = await (supabase as any)
      .from("presupuestos")
      .select("numero")
      .eq("sociedad_id", "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021")
      .order("numero", { ascending: false })
      .limit(5);
    results.push(`Lazzari latest PRs: ${JSON.stringify(lazzariPRs?.map((p: any) => p.numero))}`);

    const { data: grupoLAPRs } = await (supabase as any)
      .from("presupuestos")
      .select("numero")
      .eq("sociedad_id", "fee94607-747a-4e87-ba24-aff9032f7a56")
      .order("numero", { ascending: false })
      .limit(5);
    results.push(`GrupoLA latest PRs: ${JSON.stringify(grupoLAPRs?.map((p: any) => p.numero))}`);

    // Get max numbers for remitos and OCs too
    for (const tipo of ["remitos", "ordenes_compra"]) {
      for (const [nombre, sid] of [["Lazzari", "eee2a3c8-fe6c-494d-bd2f-7a5d8067d021"], ["GrupoLA", "fee94607-747a-4e87-ba24-aff9032f7a56"]]) {
        const { data } = await (supabase as any)
          .from(tipo)
          .select("numero")
          .eq("sociedad_id", sid)
          .order("numero", { ascending: false })
          .limit(3);
        results.push(`${nombre} ${tipo}: ${JSON.stringify(data?.map((r: any) => r.numero))}`);
      }
    }

    return NextResponse.json({ results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message, results }, { status: 500 });
  }
}
