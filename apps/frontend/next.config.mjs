/** @type {import('next').NextConfig} */
export default {
  // Preserve the /api prefix: the backend mounts everything under /api/*.
  // (The previous config forwarded to /:path*, which 404'd every call.)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
};
