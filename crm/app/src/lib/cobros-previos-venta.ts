import { supabase } from "@/lib/supabase/client";
import { traerTodo } from "@/lib/paginar";
import { cobradoParaCobrar } from "@/lib/saldo-clientes";

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
    // La cuenta (y lo que frena) está en lib/saldo-clientes → cobradoParaCobrar, probada junto a cobradoPorFactura (P24).
    return cobradoParaCobrar(documents, direct.data, applications.data);
}
