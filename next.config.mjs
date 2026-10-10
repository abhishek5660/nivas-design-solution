/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};
export default nextConfig;
