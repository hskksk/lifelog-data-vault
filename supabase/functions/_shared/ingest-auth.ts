/** OwnTracks HTTP mode sends Basic auth; curl/scripts may use Bearer. */

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function basicPassword(authorization: string): string | null {
  if (!authorization.startsWith("Basic ")) return null;
  try {
    const decoded = atob(authorization.slice(6).trim());
    const colon = decoded.indexOf(":");
    if (colon < 0) return decoded;
    return decoded.slice(colon + 1);
  } catch {
    return null;
  }
}

export function authorizeIngestRequest(
  authorization: string | undefined,
  ingestToken: string,
): boolean {
  if (!authorization) return false;
  if (authorization === `Bearer ${ingestToken}`) return true;
  const password = basicPassword(authorization);
  return password !== null && timingSafeEqual(password, ingestToken);
}
