"use client";

// Finanzas Lazza → Movimientos → "Nuevo movimiento" (23/10/2026, pedido de Augusto para la mudanza de Finanzas).
// Mismo alta manual que Finanzas (handleCreateMov): un insert en `movimientos` con la sociedad activa y un cliente o proveedor.
// Sin retenciones (Augusto: "sacale las retenciones"). Cliente/proveedor con Autocompletar.
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Input, Select } from "@/components/ui/input";
import Autocompletar from "@/components/ui/autocompletar";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useUser } from "@/lib/auth-context";
import { formatCurrency, formatDate, todayAR } from "@/lib/utils";
import { movimientoParecido, rangoParecido, TOLERANCIA_PARECIDO } from "@/lib/cobro-parecido";

const db = supabase as any;

const TIPOS = [
  { value: "cobro", label: "Cobro" }, { value: "pago", label: "Pago" },
  { value: "cheque_emitido", label: "Cheque emitido" }, { value: "cheque_recibido", label: "Cheque recibido" },
  { value: "transferencia", label: "Transferencia" }, { value: "efectivo", label: "Efectivo" },
  { value: "deposito", label: "Depósito" }, { value: "ajuste", label: "Ajuste" },
];

export interface DatosMovimientoNuevo { tipo: string; descripcion: string; monto: number; moneda: "ARS" | "USD"; fecha: string; entidad: string }

/** Valida lo mismo que Finanzas; devuelve el mensaje de error o null. */
export function errorMovimientoNuevo(f: DatosMovimientoNuevo): string | null {
  if (!f.descripcion.trim()) return "La descripción es obligatoria";
  if (!(f.monto > 0)) return "El monto debe ser mayor a 0";
  if (!f.entidad) return "Elegí un cliente o proveedor";
  return null;
}

/**
 * Lo ya cargado de ese cliente o proveedor que se parece al nuevo (importe ±$ 1, a 5 días o menos). Auditoría de la plata
 * (30/10/2026, punto 6): un cobro suelto no baja la cuenta corriente y la factura se volvía a cobrar. Si no se puede leer, null.
 */
async function buscarParecido(f: DatosMovimientoNuevo, sociedadId: string) {
  const r = rangoParecido([f.fecha]);
  if (!r || f.tipo === "ajuste") return null;
  const { data, error } = await db.from("movimientos").select("id, fecha, monto, moneda, tipo, descripcion")
    .eq("sociedad_id", sociedadId).eq(f.entidad.startsWith("c:") ? "cliente_id" : "proveedor_id", f.entidad.slice(2)).eq("moneda", f.moneda)
    .gte("fecha", r.desde).lte("fecha", r.hasta).gte("monto", f.monto - TOLERANCIA_PARECIDO).lte("monto", f.monto + TOLERANCIA_PARECIDO)
    .not("tipo", "in", "(ajuste,retencion_iva,retencion_ganancias,retencion_iibb,retencion_suss)").or("anulado.is.null,anulado.eq.false");
  if (error) return null;
  const filas: { id: string; fecha: string; monto: number; moneda: "ARS" | "USD"; tipo: string; descripcion: string | null }[] = data || [];
  return movimientoParecido({ fecha: f.fecha, monto: f.monto, moneda: f.moneda }, filas);
}

const vacio = (): DatosMovimientoNuevo => ({ tipo: "cobro", descripcion: "", monto: 0, moneda: "ARS", fecha: todayAR(), entidad: "" });

export function NuevoMovimiento({ sociedadId, abierto, onClose, onGuardado }: { sociedadId: string; abierto: boolean; onClose: () => void; onGuardado: () => void }) {
  const { profile } = useUser();
  const [form, setForm] = useState<DatosMovimientoNuevo>(vacio);
  const [personas, setPersonas] = useState<{ valor: string; texto: string; detalle: string }[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  // Doble clic en Guardar = un solo movimiento.
  const enCurso = useRef(false);

  useEffect(() => {
    if (!abierto) return;
    setForm(vacio()); setError("");
    let vivo = true;
    Promise.all([
      traerTodo<any>(() => db.from("clientes").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
      traerTodo<any>(() => db.from("proveedores").select("id, razon_social, cuit").eq("sociedad_id", sociedadId).order("id")),
    ]).then(([cs, ps]) => {
      if (!vivo) return;
      setPersonas([
        ...cs.map((c) => ({ valor: `c:${c.id}`, texto: c.razon_social, detalle: `Cliente${c.cuit ? ` · ${c.cuit}` : ""}` })),
        ...ps.map((p) => ({ valor: `p:${p.id}`, texto: p.razon_social, detalle: `Proveedor${p.cuit ? ` · ${p.cuit}` : ""}` })),
      ]);
    }).catch((e) => { console.error("Nuevo movimiento:", e); if (vivo) setError("No se pudieron cargar clientes y proveedores. Cerrá y volvé a abrir."); });
    return () => { vivo = false; };
  }, [abierto, sociedadId]);

  const elegida = useMemo(() => personas.find((p) => p.valor === form.entidad), [personas, form.entidad]);

  const guardar = async () => {
    const e = errorMovimientoNuevo(form);
    if (e) { setError(e); return; }
    if (enCurso.current) return;
    enCurso.current = true;
    setGuardando(true); setError("");
    try {
      const p = await buscarParecido(form, sociedadId);
      if (p && !confirm(`Ya hay un movimiento parecido de ${form.entidad.startsWith("c:") ? "este cliente" : "este proveedor"}:\n${formatDate(p.fecha)} · ${TIPOS.find((t) => t.value === p.tipo)?.label || p.tipo} · ${formatCurrency(Number(p.monto), p.moneda)}${p.descripcion ? ` · ${p.descripcion}` : ""}\n\n¿Es otro? Aceptar lo guarda igual.`)) return;
      const fila: Record<string, unknown> = {
        tipo: form.tipo, descripcion: form.descripcion.trim(), monto: form.monto, moneda: form.moneda, fecha: form.fecha, sociedad_id: sociedadId,
      };
      if (form.entidad.startsWith("c:")) fila.cliente_id = form.entidad.slice(2); else fila.proveedor_id = form.entidad.slice(2);
      if (profile?.id) fila.created_by = profile.id;
      const { error: err } = await db.from("movimientos").insert(fila);
      if (err) throw err;
      onGuardado(); onClose();
    } catch (err: any) {
      setError(err?.message || "Error al guardar");
    } finally { setGuardando(false); enCurso.current = false; }
  };

  return (
    <Modal open={abierto} onClose={onClose} title="Nuevo movimiento" size="sm"
      footer={<>
        <button type="button" onClick={onClose} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-700">Cancelar</button>
        <button type="button" disabled={guardando} onClick={() => void guardar()} className="rounded-lg bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">{guardando ? "Guardando…" : "Guardar"}</button>
      </>}>
      <div className="space-y-3">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">{error}</p>}
        <Select label="Tipo" options={TIPOS} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })} />
        <Input label="Descripción *" value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Monto *" type="number" min={0} step="0.01" value={form.monto || ""} onChange={(e) => setForm({ ...form, monto: Number(e.target.value) })} />
          <Select label="Moneda" options={[{ value: "ARS", label: "ARS" }, { value: "USD", label: "USD" }]} value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value as "ARS" | "USD" })} />
        </div>
        <Input label="Fecha" type="date" value={form.fecha} onChange={(e) => setForm({ ...form, fecha: e.target.value })} />
        <div>
          <p className="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">Cliente o proveedor *</p>
          {elegida ? (
            <p className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-sm dark:border-emerald-800 dark:bg-emerald-950/30">
              <span>{elegida.texto} <span className="text-xs text-zinc-500">· {elegida.detalle}</span></span>
              <button type="button" onClick={() => setForm({ ...form, entidad: "" })} className="text-xs text-zinc-500 hover:text-zinc-700">Cambiar</button>
            </p>
          ) : (
            <Autocompletar opciones={personas} placeholder="Escribí el nombre o CUIT…" onElegir={(v) => setForm({ ...form, entidad: v })} className="w-full" />
          )}
        </div>
      </div>
    </Modal>
  );
}
