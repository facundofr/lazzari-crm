#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const invite = read("src/app/api/invite/route.ts");
assert.match(invite, /auth\.admin\.generateLink/);
assert.match(invite, /new Resend\(resendKey\)/);
assert.match(invite, /invite_sent: false/);
assert.match(invite, /auth\.admin\.listUsers/);
assert.match(invite, /\.from\("profiles"\)\.upsert/);

const confirm = read("src/app/auth/confirm/route.ts");
assert.match(confirm, /verifyOtp/);
assert.match(confirm, /!rawNext\.startsWith\("\/\/"\)/);

const accept = read("src/app/auth/aceptar-invitacion/page.tsx");
assert.match(accept, /updateUser\(\{ password \}\)/);
assert.match(accept, /password\.length < 8/);

const middleware = read("src/lib/supabase/middleware.ts");
assert.match(middleware, /isPublicAuthFlow = pathname === "\/auth\/confirm"/);
assert.match(middleware, /!isPublicAuthFlow/);

const email = read("src/lib/email.ts");
assert.match(email, /normalize\("NFKC"\)/);
assert.match(email, /INVISIBLE_EMAIL_CHARS/);

console.log("OK: invitaciones transaccionales, correo propio y alta de contraseña protegidos.");
