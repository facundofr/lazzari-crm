import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";

/**
 * Lo cobrado de cada factura de venta (cobros directos + aplicaciones vigentes), por id. Se usa en Facturación y en la nota de crédito.
 * Movida tal cual desde facturacion-content.tsx (cuenta sin cambios); ahora recibe la sociedad.
 */
export async function fetchCobradoMap(sociedadActiva: { id?: string } | null | undefined, input: { id: string; moneda: string } | { id: string; moneda: string }[]): Promise<Record<string, number>> {
    if (!sociedadActiva?.id) throw new Error("No se pudo identificar la sociedad para verificar los saldos.");
    const documents=Array.isArray(input)?input:[input];
    if(!documents.length)return {};
    const ids=documents.map(f=>f.id);
    // B4: de a tandas de ids (URL corta) y paginado (más de 1000 cobros).
    const sociedadId=sociedadActiva.id;
    const direct={data:[] as any[]}, applications={data:[] as any[]};
    try{
      for(let i=0;i<ids.length;i+=150){
        const lote=ids.slice(i,i+150);
        const [d,a]=await Promise.all([
          traerTodo(()=>(supabase as any).from("movimientos").select("id,factura_id,monto,moneda,anulado").in("factura_id",lote).eq("sociedad_id",sociedadId).order("id")),
          traerTodo(()=>(supabase as any).from("cobro_aplicaciones").select("movimiento_id,factura_id,monto,movimientos!inner(anulado,sociedad_id)").in("factura_id",lote).eq("movimientos.sociedad_id",sociedadId).order("movimiento_id").order("factura_id")),
        ]);
        direct.data.push(...d); applications.data.push(...a);
      }
    }catch{throw new Error("No se pudieron verificar los cobros previos; no se habilitó el cobro. Reintentá la consulta.");}
    const totals:Record<string,number>={};
    // Un cobro con aplicaciones ya se cuenta por ellas: no se suma también como directo (igual que Finanzas y lib/saldo-clientes).
    const movimientosAplicados=new Set<string>((applications.data||[]).map((a:any)=>a.movimiento_id).filter(Boolean));
    for(const m of direct.data||[]){
      if(m.anulado||movimientosAplicados.has(m.id))continue;
      const doc=documents.find(f=>f.id===m.factura_id);
      if(!doc || (m.moneda||"ARS")!==doc.moneda)throw new Error("Hay un cobro previo en otra moneda sin aplicación conciliada. Revisalo antes de continuar.");
      if(!Number.isFinite(Number(m.monto)))throw new Error("Un cobro previo tiene un importe inválido.");
      totals[m.factura_id]=(totals[m.factura_id]||0)+Number(m.monto);
    }
    for(const a of applications.data||[]){
      const movement=Array.isArray(a.movimientos)?a.movimientos[0]:a.movimientos;
      if(!movement)throw new Error("Una aplicación no tiene un movimiento verificable.");
      if(movement.anulado)continue;
      if(!Number.isFinite(Number(a.monto)))throw new Error("Una aplicación de cobro tiene un importe inválido.");
      // Application amount is ALWAYS in the invoice's currency; FX cash is ARS
      // with factura_id null, so it must not also be counted as a direct payment.
      totals[a.factura_id]=(totals[a.factura_id]||0)+Number(a.monto);
    }
    return totals;
}
