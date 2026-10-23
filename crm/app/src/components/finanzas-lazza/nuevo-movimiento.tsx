"use client";

// Finanzas Lazza → Movimientos → "Nuevo movimiento" (23/10/2026, pedido de Augusto para la mudanza de Finanzas).
// Mismo alta manual que Finanzas (handleCreateMov): un insert en `movimientos` con la sociedad activa y un cliente o proveedor.
// Sin retenciones (Augusto: "sacale las retenciones"). Cliente/proveedor con Autocompletar.
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Input, Select } from "@/components/ui/input";
import Autocompletar from "@/components/ui/autocompletar";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { useUser } from "@/lib/auth-context";
import { todayAR } from "@/lib/utils";

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

const vacio = (): DatosMovimientoNuevo => ({ tipo: "cobro", descripcion: "", monto: 0, moneda: "ARS", fecha: todayAR(), entidad: "" });

export function NuevoMovimiento({ sociedadId, abierto, onClose, onGuardado }: { sociedadId: string; abierto: boolean; onClose: () => void; onGuardado: () => void }) {
  const { profile } = useUser();
  const [form, setForm] = useState<DatosMovimientoNuevo>(vacio);
  const [personas, setPersonas] = useState<{ valor: string; texto: string; detalle: string }[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

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
    setGuardando(true); setError("");
    try {
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
    } finally { setGuardando(false); }
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
