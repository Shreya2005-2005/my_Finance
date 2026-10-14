/**
 * SAFE URL CHECK (protection against "SSRF").
 *
 * Whenever the backend downloads a page or PDF for a user, it must not be tricked into reaching
 * private places such as the server's own internal network. These rules refuse anything suspicious
 * BEFORE any request is made.
 */
export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const PRIVATE_V4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // cloud metadata addresses live here
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

/**
 * @param allowedHosts when given, the host must equal one of these or be a subdomain of one.
 */
export function checkFetchUrl(raw: string, allowedHosts?: string[]): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Not a valid web address." };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "Only https addresses are allowed." };
  if (url.username || url.password) return { ok: false, reason: "Addresses with a login inside are not allowed." };
  if (url.port && url.port !== "443") return { ok: false, reason: "Unusual ports are not allowed." };

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { ok: false, reason: "Local addresses are not allowed." };
  }
  if (host.startsWith("[") || host.includes(":")) return { ok: false, reason: "Raw IPv6 addresses are not allowed." };
  if (/^\d+(\.\d+){3}$/.test(host)) {
    if (PRIVATE_V4.some((r) => r.test(host))) return { ok: false, reason: "Private network addresses are not allowed." };
    return { ok: false, reason: "Raw IP addresses are not allowed." };
  }
  if (!host.includes(".")) return { ok: false, reason: "Single-word host names are not allowed." };

  if (allowedHosts && !allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, reason: `Only these sites can be read here: ${allowedHosts.join(", ")}.` };
  }
  return { ok: true, url };
}
