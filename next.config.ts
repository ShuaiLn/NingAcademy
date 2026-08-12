import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
