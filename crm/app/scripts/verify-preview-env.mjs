const productionRef = "ycuzszzskqatlegtbgbq";

function projectRef(url) {
  try { return new URL(url || "").hostname.split(".")[0] || ""; }
  catch { return ""; }
}

const ref = projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
const errors = [];
if (!ref) errors.push("Falta NEXT_PUBLIC_SUPABASE_URL");
if (ref === productionRef) errors.push("NEXT_PUBLIC_SUPABASE_URL apunta a producción");
if (process.env.TEST_SUPABASE_PROJECT_REF && ref !== process.env.TEST_SUPABASE_PROJECT_REF) errors.push("La referencia Supabase no coincide con TEST_SUPABASE_PROJECT_REF");
if (process.env.ARCA_PRODUCTION !== "false") errors.push("ARCA_PRODUCTION debe ser false");
if (!process.env.ARCA_CERT_B64 || !process.env.ARCA_KEY_B64) errors.push("Faltan certificado o clave de ARCA homologación para Lazzari");

if (errors.length) {
  console.error(`Entorno Preview inseguro:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`OK: Preview aislado (Supabase ${ref.slice(0, 4)}…; ARCA homologación).`);
