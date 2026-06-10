import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Subida de imágenes (avatar, banner, portadas, referencias) en base64
      bodySizeLimit: "12mb",
    },
  },
};

export default nextConfig;
