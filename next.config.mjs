import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Üst klasördeki başka bir package-lock.json kök sanılmasın
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
};
export default nextConfig;
