const PRODUCTION_SUPABASE_REF = "ycuzszzskqatlegtbgbq";

export function supabaseProjectRef(url?: string): string {
  try { return new URL(url || "").hostname.split(".")[0] || ""; }
  catch { return ""; }
}

/**
 * Preview/test fiscal work must fail closed. Production remains available only
 * outside those explicitly isolated environments.
 */
export function assertSafeFiscalEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  const isolated = env.VERCEL_ENV === "preview" || env.FISCAL_TEST_MODE === "true";
  if (!isolated) return;

  const projectRef = supabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  if (!projectRef) throw new Error("Entorno de prueba inválido: falta NEXT_PUBLIC_SUPABASE_URL.");
  if (projectRef === PRODUCTION_SUPABASE_REF) {
    throw new Error("Entorno de prueba bloqueado: Supabase apunta a la base productiva.");
  }
  if (env.TEST_SUPABASE_PROJECT_REF && projectRef !== env.TEST_SUPABASE_PROJECT_REF) {
    throw new Error("Entorno de prueba bloqueado: Supabase no coincide con TEST_SUPABASE_PROJECT_REF.");
  }
  if (env.ARCA_PRODUCTION !== "false") {
    throw new Error("Entorno de prueba bloqueado: ARCA_PRODUCTION debe ser false para homologación.");
  }
}
