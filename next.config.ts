import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The maximum valid 100-row Phase 2 confirmation serializes to about
    // 1.86 MiB through React Flight in the worst escaping case.
    serverActions: { bodySizeLimit: "3mb" },
  },
  // Legacy routes superseded by the assignments hub + rebrand.
  // /student/vocabulary is deliberately NOT redirected -- it remains the
  // real, enriched list page (see app/student/vocabulary/page.tsx).
  async redirects() {
    return [
      {
        source: "/teacher/vocabulary",
        destination: "/teacher/assignments",
        permanent: false,
      },
      {
        source: "/teacher/vocabulary/new",
        destination: "/teacher/assignments/new",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/local-ai-assets/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
