/**
 * /api/ui-state — Handler 模式（优先于 [[default]] Express）
 * 在 EdgeOne 控制台将 KV 命名空间绑定为变量名 ui_state_kv 后可跨冷启动持久化。
 */
const KV_KEY = 'ui-state';
const VALID_PAGES = new Set(['capture', 'convert', 'video', 'image', 'chat']);

let memoryState = {
  activePage: 'capture',
  updatedAt: new Date().toISOString(),
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
  });

const getKv = (context) => {
  const env = context?.env;
  if (!env || typeof env !== 'object') return null;
  return env.ui_state_kv ?? env.UI_STATE_KV ?? null;
};

const readState = async (context) => {
  const kv = getKv(context);
  if (kv) {
    try {
      const stored = await kv.get(KV_KEY, { type: 'json' });
      if (
        stored &&
        typeof stored.activePage === 'string' &&
        VALID_PAGES.has(stored.activePage)
      ) {
        return {
          activePage: stored.activePage,
          updatedAt: stored.updatedAt || new Date().toISOString(),
        };
      }
    } catch (err) {
      console.error('[ui-state] KV read failed:', err);
    }
  }
  return memoryState;
};

const writeState = async (context, activePage) => {
  const next = {
    activePage,
    updatedAt: new Date().toISOString(),
  };
  const kv = getKv(context);
  if (kv) {
    await kv.put(KV_KEY, JSON.stringify(next));
  }
  memoryState = next;
  return next;
};

const parseActivePage = (body) => {
  const value = body?.activePage;
  return typeof value === 'string' && VALID_PAGES.has(value) ? value : null;
};

export async function onRequestGet(context) {
  const state = await readState(context);
  return json({ activePage: state.activePage, updatedAt: state.updatedAt });
}

const handleWrite = async (context) => {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const activePage = parseActivePage(body);
  if (!activePage) {
    return json({ error: 'invalid activePage' }, 400);
  }

  const state = await writeState(context, activePage);
  return json({ activePage: state.activePage, updatedAt: state.updatedAt });
};

export const onRequestPut = handleWrite;
export const onRequestPost = handleWrite;
