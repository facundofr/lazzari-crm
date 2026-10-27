import assert from "node:assert/strict";
import { nombreAccionRegistro, nombreCodigoBanco, nombreEstadoBanco, nombreEstadoBancoTitulo, nombreEstadoCheque, quitarCodigosBanco } from "../src/lib/nombres-estados";

assert.equal(nombreEstadoCheque("en_cartera"), "en cartera");
assert.equal(nombreEstadoCheque("Entregado"), "entregado");
assert.equal(nombreEstadoCheque("algo_nuevo"), "algo nuevo", "un estado que no está en la lista igual sale sin guiones");
assert.equal(nombreEstadoCheque(null), "");

assert.equal(nombreEstadoBanco("PAGADO"), "pagado");
assert.equal(nombreEstadoBanco("CUSTODIA"), "en custodia");
assert.equal(nombreEstadoBanco(" repudiado "), "repudiado", "tolera minúsculas y espacios");
assert.equal(nombreEstadoBanco("EN_PROCESO"), "en proceso");
assert.equal(nombreEstadoBancoTitulo("PAGADO"), "Pagado");

assert.equal(nombreAccionRegistro("extracto_cargado"), "Extracto cargado");
assert.equal(nombreAccionRegistro("regla_creada"), "Regla creada");
assert.equal(nombreAccionRegistro("ia_sugirio"), "La IA sugirió");
assert.equal(nombreAccionRegistro("asistente_leyo_correos"), "El asistente leyó los correos");
assert.equal(nombreAccionRegistro("otra_cosa"), "Otra cosa", "una acción nueva igual se lee");

assert.equal(quitarCodigosBanco("PAGO SERVICI 17779347 OP3636 #137"), "PAGO SERVICI 17779347 OP3636");
assert.equal(quitarCodigosBanco("21/10 $ 100 · IVA TASA GRA #236 → IVA del banco"), "21/10 $ 100 · IVA TASA GRA → IVA del banco");
assert.equal(quitarCodigosBanco("sin código"), "sin código");
assert.equal(quitarCodigosBanco("Cheque #12345"), "Cheque #12345", "solo saca los de 3 dígitos del banco");

assert.equal(nombreCodigoBanco("137"), "Pagos servicios ARCA");
assert.equal(nombreCodigoBanco("236"), "IVA 21%");
assert.equal(nombreCodigoBanco("999"), null);
assert.equal(nombreCodigoBanco(null), null);

console.log("test-nombres-estados OK");
