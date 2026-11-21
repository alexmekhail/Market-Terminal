/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The dashboard has no next/image consumers and does not need the optimizer.
    unoptimized: true,
  },
};

module.exports = nextConfig;
