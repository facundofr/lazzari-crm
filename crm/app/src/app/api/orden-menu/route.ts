import { NextResponse } from "next/server";
import { guardarConfigGlobal, leerConfigGlobal, rolDelUsuario } from "@/lib/config-global-server";
import { CLAVE_ORDEN_MENU, ordenValido } from "@/lib/orden-menu";

/**
 * /api/orden-menu — orden del menú que elige Augusto (lib/orden-menu.ts).
 * GET: cualquier usuario logueado (todos ven el mismo orden). PUT: solo super_admin; `{ orden: null }` vuelve al de fábrica.
 * Solo guarda el orden (lista de rutas): los permisos de cada pantalla no cambian.
 */

export async function GET() {
  if (!(await rolDelUsuario())) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ orden: ordenValido(await leerConfigGlobal(CLAVE_ORDEN_MENU)) });
}

export async function PUT(req: Request) {
  const rol = await rolDelUsuario();
  if (!rol) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (rol !== "super_admin") return NextResponse.json({ error: "Solo Augusto puede ordenar el menú" }, { status: 403 });
  const cuerpo = await req.json().catch(() => ({}));
  const orden = ordenValido(cuerpo?.orden);
  if (cuerpo?.orden !== null && !orden) return NextResponse.json({ error: "Orden inválido" }, { status: 400 });
  // Volver al de fábrica guarda una lista vacía (la fila queda, sin borrar nada).
  const error = await guardarConfigGlobal(CLAVE_ORDEN_MENU, orden ?? []);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ orden });
}
