export type SalesCreditNoteMode = "total" | "items" | "amount";

export type CreditNoteItem = {
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  iva_porcentaje: number;
};

export function roundCreditMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function creditNoteTypeForInvoice(tipo: string): "NCA" | "NCB" | "NCEA" | "NCEB" {
  if (tipo === "FCEA") return "NCEA";
  if (tipo === "FCEB") return "NCEB";
  if (tipo === "FA") return "NCA";
  return "NCB";
}

export function isInvoiceA(tipo: string): boolean {
  return tipo === "FA" || tipo === "FCEA";
}

export function creditNoteTotals(items: CreditNoteItem[], facturaA: boolean) {
  return items.reduce((acc, item) => {
    if (facturaA) {
      const neto = roundCreditMoney(Number(item.cantidad) * Number(item.precio_unitario));
      const iva = roundCreditMoney(neto * Number(item.iva_porcentaje || 0) / 100);
      return {
        neto: roundCreditMoney(acc.neto + neto),
        iva: roundCreditMoney(acc.iva + iva),
        total: roundCreditMoney(acc.total + neto + iva),
      };
    }
    const total = roundCreditMoney(Number(item.cantidad) * Number(item.precio_unitario));
    const ivaPct = Number(item.iva_porcentaje || 0);
    const neto = ivaPct > 0 ? roundCreditMoney(total / (1 + ivaPct / 100)) : total;
    return {
      neto: roundCreditMoney(acc.neto + neto),
      iva: roundCreditMoney(acc.iva + total - neto),
      total: roundCreditMoney(acc.total + total),
    };
  }, { neto: 0, iva: 0, total: 0 });
}

export function freeAmountCreditItem(total: number, ivaPorcentaje: number, facturaA: boolean): CreditNoteItem {
  const safeTotal = roundCreditMoney(Math.max(0, Number(total) || 0));
  const safeIva = Math.max(0, Number(ivaPorcentaje) || 0);
  const precio = facturaA && safeIva > 0
    ? roundCreditMoney(safeTotal / (1 + safeIva / 100))
    : safeTotal;
  return {
    descripcion: "Ajuste parcial sobre factura",
    cantidad: 1,
    precio_unitario: precio,
    iva_porcentaje: safeIva,
  };
}

export function salesCreditAllocation(params: {
  invoiceTotal: number;
  alreadyCredited?: number;
  alreadyPaid?: number;
  noteTotal: number;
}) {
  const saldoAntes = roundCreditMoney(Math.max(
    0,
    Number(params.invoiceTotal || 0)
      - Number(params.alreadyCredited || 0)
      - Number(params.alreadyPaid || 0),
  ));
  const noteTotal = roundCreditMoney(Math.max(0, Number(params.noteTotal || 0)));
  const aplicado = roundCreditMoney(Math.min(saldoAntes, noteTotal));
  const saldoFavor = roundCreditMoney(Math.max(0, noteTotal - aplicado));
  return {
    saldoAntes,
    aplicado,
    saldoFavor,
    saldoDespues: roundCreditMoney(Math.max(0, saldoAntes - aplicado)),
    exceedsBalance: saldoFavor > 0,
  };
}
