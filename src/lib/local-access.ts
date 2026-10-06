export function isLocalRequest(request: Request): boolean {
  const host = request.headers.get("host") ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== `http://${host}`) return false;
  const site = request.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}
