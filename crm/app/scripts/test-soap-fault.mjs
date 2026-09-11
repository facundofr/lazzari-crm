import assert from "node:assert/strict";
import { soapCall } from "@ramiidv/arca-common";

const originalFetch = globalThis.fetch;
const response = (body, status, statusText = "Internal Server Error") => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  text: async () => body,
});

try {
  let calls = 0;
  globalThis.fetch = async () => response(
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Server</faultcode><faultstring>El certificado no es válido</faultstring></soap:Fault></soap:Body></soap:Envelope>`,
    500,
  );
  await assert.rejects(
    () => soapCall("https://offline.invalid", "<loginCms/>", { retries: 0 }),
    (error) => error.statusCode === 500 && error.message.includes("SOAP Fault: El certificado no es válido"),
  );

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(
      `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">Already authenticated; token=SECRET sign=PRIVATE</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`,
      500,
    );
  };
  await assert.rejects(
    () => soapCall("https://offline.invalid", "<loginCms/>", { retries: 2, retryDelayMs: 0 }),
    (error) => error.statusCode === 500 && error.message.includes("Already authenticated") && error.message.includes("token=[redacted]") && error.message.includes("sign=[redacted]") && !error.message.includes("SECRET") && !error.message.includes("PRIVATE"),
  );
  assert.equal(calls, 1, "SOAP Fault no debe reintentarse");

  calls = 0;
  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response("not xml", 500);
  };
  await assert.rejects(
    () => soapCall("https://offline.invalid", "<loginCms/>", { retries: 1, retryDelayMs: 0 }),
    (error) => error.statusCode === 500 && !error.message.includes("not xml"),
  );
  assert.equal(calls, 2, "HTTP 500 sin SOAP Fault conserva el reintento configurado");

  globalThis.fetch = async () => response(
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ok/></soap:Body></soap:Envelope>`,
    200,
    "OK",
  );
  const parsed = await soapCall("https://offline.invalid", "<ping/>", { retries: 0 });
  assert.ok(parsed["soap:Envelope"]);
  console.log("SOAP fault offline checks: OK");
} finally {
  globalThis.fetch = originalFetch;
}
