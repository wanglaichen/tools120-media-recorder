/** /api/health — Handler 模式，优先于静态 404 */
export function onRequestGet(context) {
  const clientIp = context?.clientIp || '-';
  return new Response(
    JSON.stringify({ ok: true, via: 'cloud-functions', clientIp }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    },
  );
}
