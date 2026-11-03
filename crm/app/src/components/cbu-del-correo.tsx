"use client";

// CBU que llegaron por mail (Augusto 03/11/2026: "si tenés los datos 100 % correctos, actualizame los datos bancarios… No inventes
// ningún dato"). En Clientes y Proveedores, arriba de la lista: los CBU que leyó el agente de correo y que son seguros según
// lib/cbu (dígitos verificadores, CUIT del titular = CUIT de la ficha, mail de una dirección de la ficha). Nada se guarda solo:
// «Guardar» de a uno; si la ficha ya tiene otro CBU, se avisa (⚠ puede ser una estafa de "cambiamos de cuenta") y pide confirmar.
import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { formatDate } from "@/lib/utils";
import { datosBancariosDeMails, proponerCbu, type FichaBancaria, type PropuestaCbu, type TipoFicha } from "@/lib/cbu";

const db = supabase as any;
const cbuLindo = (c: string) => `${c.slice(0, 8)} ${c.slice(8)}`;

export function CbuDelCorreo({ tipo, sociedadId, onGuardado }: { tipo: TipoFicha; sociedadId: string; onGuardado?: () => void }) {
  const [propuestas, setPropuestas] = useState<PropuestaCbu[]>([]);
  const [vacios, setVacios] = useState<Map<string, Record<string, boolean>>>(new Map());
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [hechos, setHechos] = useState<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    try {
      const tabla = tipo === "cliente" ? "clientes" : "proveedores";
      const campos = tipo === "cliente" ? "id, razon_social, cuit, alias_cbu, email, email_facturacion, email_comprobante" : "id, razon_social, cuit, cbu, email, alias_bancario, banco, titular_cuenta, cuit_titular_cuenta";
      const [mails, fichas, contactos] = await Promise.all([
        db.from("agente_mail_procesados").select("id, fecha_mail, remitente, asunto, datos").eq("categoria", tipo === "cliente" ? "pago_retencion" : "factura_proveedor")
          .order("fecha_mail", { ascending: false }).limit(1000).then(({ data }: { data: any[] | null }) => data || []),
        traerTodo<any>(() => db.from(tabla).select(campos).eq("sociedad_id", sociedadId).order("id")),
        traerTodo<any>(() => db.from("contactos").select("id, entity_id, email").eq("entity_type", tipo).order("id")),
      ]);
      const correosDe = new Map<string, string[]>();
      for (const k of contactos) if (k.entity_id && k.email) correosDe.set(k.entity_id, [...(correosDe.get(k.entity_id) || []), k.email]);
      const lista: FichaBancaria[] = fichas.map((f: any) => ({
        id: f.id, tipo, nombre: f.razon_social || "", cuit: f.cuit || null, cbu: tipo === "cliente" ? f.alias_cbu || null : f.cbu || null,
        correos: [f.email, f.email_facturacion, f.email_comprobante, ...(correosDe.get(f.id) || [])].filter(Boolean),
      }));
      // Qué datos de la ficha del proveedor están vacíos (alias, banco, titular): solo esos se completan con lo del mail.
      setVacios(new Map(fichas.map((f: any) => [f.id, { alias: !f.alias_bancario, banco: !f.banco, titular: !f.titular_cuenta, cuitTitular: !f.cuit_titular_cuenta }])));
      setPropuestas(proponerCbu(datosBancariosDeMails(mails), lista).propuestas);
    } catch (e) {
      console.warn("CBU del correo:", e);
      setPropuestas([]);
    }
  }, [tipo, sociedadId]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function guardar(p: PropuestaCbu) {
    if (p.estado === "distinto" && !confirm(`⚠ ${p.ficha.nombre} ya tiene otro CBU en su ficha (${p.ficha.cbu}).\n\nUn mail que "cambia la cuenta" puede ser una estafa. Antes de cambiarlo, confirmalo por teléfono con ${tipo === "cliente" ? "el cliente" : "el proveedor"}.\n\n¿Cambiarlo igual por ${p.cbu}?`)) return;
    const clave = `${p.ficha.id}|${p.cbu}`;
    setGuardando(clave);
    try {
      const v = vacios.get(p.ficha.id) || {};
      const cambios: Record<string, string> = tipo === "cliente" ? { alias_cbu: p.cbu } : {
        cbu: p.cbu,
        ...(p.dato.alias && v.alias ? { alias_bancario: p.dato.alias } : {}),
        ...(p.dato.banco && v.banco ? { banco: p.dato.banco } : {}),
        ...(p.dato.titular && v.titular ? { titular_cuenta: p.dato.titular } : {}),
        ...(p.dato.cuitTitular && v.cuitTitular ? { cuit_titular_cuenta: p.dato.cuitTitular } : {}),
      };
      const { error } = await db.from(tipo === "cliente" ? "clientes" : "proveedores").update(cambios).eq("id", p.ficha.id).eq("sociedad_id", sociedadId);
      if (error) throw error;
      setHechos((h) => new Set(h).add(clave));
      onGuardado?.();
    } catch (e: any) {
      alert(`No se pudo guardar: ${e?.message || e}`);
    } finally {
      setGuardando(null);
    }
  }

  const pendientes = propuestas.filter((p) => !hechos.has(`${p.ficha.id}|${p.cbu}`));
  if (!propuestas.length) return null;
  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Mail className="h-4 w-4 shrink-0" />
        <span>{pendientes.length ? `${pendientes.length} ${pendientes.length === 1 ? "CBU llegó" : "CBU llegaron"} por mail para completar ${tipo === "cliente" ? "fichas de clientes" : "fichas de proveedores"}.` : "Listo: se guardaron los CBU del mail."}
          <span className="text-sky-700 dark:text-sky-300"> Solo los seguros: CBU válido, titular con el CUIT de la ficha y mail de su dirección.</span></span>
        {pendientes.length > 0 && <button onClick={() => setAbierto(!abierto)} className="text-xs font-medium underline">{abierto ? "Ocultar" : "Ver"}</button>}
      </div>
      {abierto && pendientes.length > 0 && (
        <ul className="mt-1.5 space-y-1 text-xs">
          {pendientes.map((p) => {
            const clave = `${p.ficha.id}|${p.cbu}`;
            return (
              <li key={clave} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <b>{p.ficha.nombre}</b>
                <span className="font-mono">{cbuLindo(p.cbu)}</span>
                {p.dato.alias && <span>· alias {p.dato.alias}</span>}
                {p.dato.titular && <span>· titular {p.dato.titular}</span>}
                <span className="text-sky-700 dark:text-sky-300">· mail del {formatDate(p.dato.fecha)} de {p.dato.remitente.replace(/^.*</, "").replace(/>.*$/, "")}</span>
                {p.estado === "distinto" && <span className="rounded bg-amber-100 px-1.5 text-amber-800 dark:bg-amber-950 dark:text-amber-200">⚠ la ficha tiene otro CBU: confirmalo por teléfono</span>}
                <button disabled={guardando !== null} onClick={() => void guardar(p)}
                  className="rounded-md bg-emerald-600 px-2 py-0.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                  {guardando === clave ? <Loader2 className="h-3 w-3 animate-spin" /> : p.estado === "distinto" ? "Cambiar…" : "Guardar"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
