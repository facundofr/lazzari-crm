// Prueba de chequesQueSeConfirmanSolos (src/lib/extracto-bbva.ts, 28/10/2026). Correr: npx tsx scripts/test-cheques-solos.ts
import { chequesQueSeConfirmanSolos, type ChequeCruce, type CuentaCruce, type LineaCruce } from "../src/lib/extracto-bbva";

let fallas = 0;
const ver = (que: string, ok: boolean, dato?: unknown) => { console.log(ok ? "OK  " : "MAL ", que, ok ? "" : JSON.stringify(dato)); if (!ok) fallas++; };

const cuentas: CuentaCruce[] = [{ id: "cc", tipo: "cuenta_corriente", nombre: "BBVA CC EPP LAZZARI", numero: "091-312483/1", moneda: "ARS", activa: true }];
const linea = (id: string, concepto: string, importe: number, fecha = "2026-10-27"): LineaCruce => ({ id, fecha, concepto, importe, cuenta_id: "cc" });
const cheque = (id: string, numero: string, monto: number, direccion = "emitido", estado = "cobrado"): ChequeCruce => ({ id, numero, monto, direccion, estado, fecha_pago: "2026-10-21" });

const prisina = cheque("p", "90017337", 590967.49), moliva = cheque("m", "90017327", 124755.04);
const r1 = chequesQueSeConfirmanSolos([
  linea("l1", "CH/CLEAR.48 001403007695484 N 90017337 #005", -590967.49),
  linea("l2", "CH/CLEAR.48 007200000057652 N 90017327 #005", -124755.04),
], [prisina, moliva], cuentas);
ver("los 2 cheques del 27/10 (Prisina y Moliva) se confirman solos", r1.length === 2 && r1[0].cheque_id === "p" && r1[1].cheque_id === "m", r1);
ver("la nota dice número e importe", r1[0]?.nota.includes("90017337") && r1[0]?.nota.includes("590.967,49"), r1[0]?.nota);
ver("trae la fecha de la línea", r1[0]?.fecha === "2026-10-27", r1[0]);

ver("formato PAGO CHEQUE también", chequesQueSeConfirmanSolos([linea("l", "PAGO CHEQUE 48HS CAP.FED. N 90016949", -1000)], [cheque("a", "90016949", 1000)], cuentas).length === 1);
ver("mismo número, otro importe: no", chequesQueSeConfirmanSolos([linea("l", "CH/CLEAR.48 1 N 90017337 #005", -590967.5)], [prisina], cuentas).length === 0);
ver("número que no está en el CRM (aunque el importe coincida): no",
  chequesQueSeConfirmanSolos([linea("l", "CH/CLEAR.48 1 N 90019999 #005", -590967.49)], [cheque("x", "", 590967.49, "emitido", "entregado")], cuentas).length === 0);
ver("cheque ya atado a otra línea: no", chequesQueSeConfirmanSolos([linea("l", "CH/CLEAR.48 1 N 90017337 #005", -590967.49)], [prisina], cuentas, [], new Set(["cheque_emitido:p"])).length === 0);
ver("cheque anulado: no", chequesQueSeConfirmanSolos([linea("l", "CH/CLEAR.48 1 N 90017337 #005", -590967.49)], [cheque("p", "90017337", 590967.49, "emitido", "anulado")], cuentas).length === 0);
ver("cheque recibido con ese número: no", chequesQueSeConfirmanSolos([linea("l", "CH/CLEAR.48 1 N 90017337 #005", -590967.49)], [cheque("p", "90017337", 590967.49, "recibido")], cuentas).length === 0);
ver("depósito de cheque acreditado (sin N°): no, sigue en Para confirmar",
  chequesQueSeConfirmanSolos([linea("l", "DEPOSITO CHEQUE 48HS", 290000)], [cheque("r", "62249803", 290000, "recibido", "depositado")], cuentas).length === 0);
ver("dos líneas con el mismo cheque: se confirma una sola", chequesQueSeConfirmanSolos([
  linea("a", "CH/CLEAR.48 1 N 90017337 #005", -590967.49), linea("b", "CH/CLEAR.48 2 N 90017337 #005", -590967.49, "2026-10-28"),
], [prisina], cuentas).length === 1);
if (fallas) process.exit(1);
