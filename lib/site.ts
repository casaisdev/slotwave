// Public base URL of the site: metadata, the Farcaster manifest and embed
// tags need absolute URLs. Vercel injects its production domain; an explicit
// NEXT_PUBLIC_SITE_URL overrides it for other hosts.
export function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}
