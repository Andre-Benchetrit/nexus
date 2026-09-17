import type { NextConfig } from "next";

const mib = 1024 * 1024;
const maiorUploadPermitido = Math.max(
  Number(process.env.NEXUS_IMAGE_MAX_BYTES || 10 * mib),
  Number(process.env.NEXUS_FILES_MAX_BYTES || 25 * mib),
  Number(process.env.NEXUS_KNOWLEDGE_MAX_BYTES || 50 * mib)
);

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ["react-markdown"],
    // O proxy de autenticação do Next também intercepta uploads. Sem este ajuste,
    // ele trunca corpos acima do padrão de 10 MB antes do Route Handler recebê-los.
    proxyClientMaxBodySize: maiorUploadPermitido + mib
  }
};

export default nextConfig;
