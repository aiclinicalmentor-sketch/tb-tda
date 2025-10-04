export default async function handler() {
  return new Response(JSON.stringify({ ok: true, t: Date.now() }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
