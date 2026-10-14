import type { NextConfig } from "next";

// Encabezados de seguridad para todas las páginas:
// - nadie puede meter el CRM dentro de otra página (anti-recuadro / clickjacking)
// - el navegador no adivina tipos de archivo
// - no se manda la dirección completa a otros sitios
// - cámara, micrófono y ubicación apagados (el CRM no los usa)
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
