/** @type {import('next').NextConfig} */
const backend = (process.env.NEXT_PUBLIC_API ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
export default {
  // Preserve the /api prefix: the backend mounts everything under /api/*.
  // (The previous config forwarded to /:path*, which 404'd every call.)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};
