function isIpv4Loopback(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts[0] !== "127") {
    return false;
  }
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function requireLoopbackTrueForgeUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error("TRUEFORGE_BASE_URL must be a valid loopback HTTP(S) URL.", { cause: error });
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  const loopback = hostname === "localhost" || hostname === "::1" || isIpv4Loopback(hostname);
  if (!loopback || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error("TRUEFORGE_BASE_URL must use HTTP(S) and an explicit loopback host (localhost, 127.0.0.0/8, or ::1)." );
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("TRUEFORGE_BASE_URL must not contain embedded credentials.");
  }
  return value;
}
