import { isLocalRequest } from "@/lib/local-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalRequest(request)) return Response.json({ error: "Local, same-origin access only." }, { status: 403 });
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 3000);
  try {
    const upstream = await fetch("http://127.0.0.1:8765/events", { signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    if (!upstream.ok || !upstream.body) throw new Error("Daemon unavailable");
    const reader = upstream.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const result = await reader.read();
          if (result.done) { request.signal.removeEventListener("abort", abort); stream.close(); }
          else stream.enqueue(result.value);
        } catch (error) { request.signal.removeEventListener("abort", abort); stream.error(error); }
      },
      async cancel() { abort(); request.signal.removeEventListener("abort", abort); await reader.cancel().catch(() => {}); },
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    return Response.json({ error: "Start the native daemon with npm run daemon." }, { status: 503 });
  }
}
