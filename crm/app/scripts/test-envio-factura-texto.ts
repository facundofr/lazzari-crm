import { destinatariosCortos, textoEnvioCorto } from "../src/lib/envio-factura-texto";
const ok = (c: boolean, m: string) => { if (!c) { console.error("FALLA", m); process.exit(1); } console.log("ok", m); };
ok(destinatariosCortos("seedspayables.argentina@corteva.com, german.mansilla-1@corteva.com") === "seedspayables.argentina, german.mansilla-1", "solo antes de la @");
ok(destinatariosCortos("enviada por fuera") === "por fuera", "por fuera");
ok(destinatariosCortos(null) === "", "vacío");
ok(textoEnvioCorto("2026-10-16T15:21:00Z", "a@b.com") === "16/10 · a", "fecha y mail");
ok(textoEnvioCorto("2026-10-17T01:30:00Z", "") === "16/10", "hora Argentina (UTC-3)");
ok(textoEnvioCorto(null, "a@b.com") === "", "sin envío no muestra nada");
console.log("TODO OK");
