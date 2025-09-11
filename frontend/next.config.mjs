/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  env: {
    NEXT_PUBLIC_API_ORIGIN:
      process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:4000",
  },
};
export default nextConfig;
