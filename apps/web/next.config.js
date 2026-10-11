//@ts-check

const path = require("node:path");

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

function isValidDevOriginHost(value) {
  if (
    !value ||
    value.includes("://") ||
    value.includes("/") ||
    value.includes("*") ||
    value.includes(":")
  ) {
    return false;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    return value
      .split(".")
      .map(Number)
      .every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  }

  return /^(?:localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)$/i.test(value);
}

function resolveAllowedDevOrigins(value) {
  const configured = String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(isValidDevOriginHost);

  return [...new Set(["127.0.0.1", "localhost", ...configured])];
}

const allowedDevOrigins = resolveAllowedDevOrigins(
  process.env.RQ_ALLOWED_DEV_ORIGINS,
);

const nextConfig = {
  allowedDevOrigins,
  devIndicators: false,
  logging: { incomingRequests: false },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/sign-in",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
        ],
      },
      {
        source: "/workspace/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
