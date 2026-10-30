import { NextResponse } from "next/server";
import { guardarConfigGlobal, leerConfigGlobal, rolDelUsuario } from "@/lib/config-global-server";

/**
 * /api/diseno-nuevo — "Diseño nuevo para todos" (Augusto 30/10: "que usen el que estoy usando yo").
 * GET: cualquier usuario logueado. PUT `{ todos: boolean }`: solo super_admin. Fila `diseno_nuevo_todos` de `configuracion`.
 */
const CLAVE = "diseno_nuevo_todos";

export async function GET() {
  if (!(await rolDelUsuario())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ todos: (await leerConfigGlobal(CLAVE)) === true });
}

export async function PUT(req: Request) {
  const rol = await rolDelUsuario();
  if (!rol) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (rol !== "super_admin") return NextResponse.json({ error: "Solo Augusto puede cambiar el diseño" }, { status: 403 });
  const cuerpo = await req.json().catch(() => ({}));
  if (typeof cuerpo?.todos !== "boolean") return NextResponse.json({ error: "Falta todos" }, { status: 400 });
  const error = await guardarConfigGlobal(CLAVE, cuerpo.todos);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ todos: cuerpo.todos });
}
