import assert from "node:assert/strict";
import { remitenteDelUsuario, esLinkDeNuestroStorage } from "../src/lib/email-remitente";

// Remitente: solo @lazzari.com.ar, con el nombre del perfil
assert.equal(remitenteDelUsuario("Seba@Lazzari.com.ar", "Sebastián Pérez"), "Sebastián Pérez <seba@lazzari.com.ar>");
assert.equal(remitenteDelUsuario("seba@lazzari.com.ar", null), "Lazzari <seba@lazzari.com.ar>");
assert.equal(remitenteDelUsuario("alguien@gmail.com", "Alguien"), null);
assert.equal(remitenteDelUsuario("x@lazzari.com.ar.otro.com", "X"), null);
assert.equal(remitenteDelUsuario("", "X"), null);
assert.equal(remitenteDelUsuario(null, "X"), null);
// el nombre no puede meter otra dirección
assert.equal(remitenteDelUsuario("seba@lazzari.com.ar", 'Jefe <jefe@otro.com>'), "Jefe jefe@otro.com <seba@lazzari.com.ar>");

// Adjuntos: solo nuestro Storage
const SB = "https://abcd.supabase.co";
assert.equal(esLinkDeNuestroStorage("https://abcd.supabase.co/storage/v1/object/public/productos/a.jpg", SB), true);
assert.equal(esLinkDeNuestroStorage("https://abcd.supabase.co/rest/v1/facturas", SB), false);
assert.equal(esLinkDeNuestroStorage("http://abcd.supabase.co/storage/v1/object/public/a.pdf", SB), false);
assert.equal(esLinkDeNuestroStorage("https://otro.com/storage/v1/object/a.pdf", SB), false);
assert.equal(esLinkDeNuestroStorage("http://169.254.169.254/latest/meta-data", SB), false);
assert.equal(esLinkDeNuestroStorage("no es un link", SB), false);
assert.equal(esLinkDeNuestroStorage("https://abcd.supabase.co/storage/v1/object/a.pdf", undefined), false);

console.log("OK: remitente del mail y adjuntos solo de nuestro Storage.");
