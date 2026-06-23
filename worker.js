/* ============================================================
   NASON HOME — Cloudflare Worker
   Cầu nối: Nason Kun (định dạng Anthropic) → Google Gemini (FREE tier)
   App giữ NGUYÊN 100% — worker tự dịch qua lại.

   BIẾN MÔI TRƯỜNG cần đặt trong Worker
   (Cloudflare → Worker → Settings → Variables and Secrets):
     • GEMINI_API_KEY  (BẮT BUỘC, để dạng Secret) — lấy FREE tại https://aistudio.google.com/apikey
     • GEMINI_MODEL    (tuỳ chọn) — mặc định 'gemini-2.5-flash'
     • ALLOW_ORIGIN    (tuỳ chọn) — origin được phép; mặc định GitHub Pages của NASON HOME.
                        Đặt '*' nếu muốn cho phép mọi nơi (kém an toàn hơn).
   ============================================================ */

const DEFAULT_MODEL  = 'gemini-2.5-flash';
const DEFAULT_ORIGIN = 'https://thailenasonhome-hub.github.io';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key, anthropic-version',
    'Access-Control-Max-Age': '86400'
  };
}

function pickOrigin(req, env) {
  const allow = (env && env.ALLOW_ORIGIN) || DEFAULT_ORIGIN;
  if (allow === '*') return '*';
  const reqOrigin = req.headers.get('Origin') || '';
  const list = allow.split(',').map(s => s.trim());
  if (reqOrigin && (
        list.indexOf(reqOrigin) >= 0 ||
        /^https?:\/\/localhost(:\d+)?$/.test(reqOrigin) ||
        /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(reqOrigin)
      )) return reqOrigin;
  return list[0]; // origin mặc định → trình duyệt từ nơi khác sẽ bị CORS chặn
}

export default {
  async fetch(req, env) {
    const origin = pickOrigin(req, env);
    const H = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method === 'GET')     return new Response(JSON.stringify({ ok: true, msg: 'NASON AI proxy (Gemini) đang chạy. Dùng POST.' }), { status: 200, headers: H });
    if (req.method !== 'POST')     return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: H });

    const key = env && env.GEMINI_API_KEY;
    if (!key) return new Response(JSON.stringify({ error: 'Thiếu GEMINI_API_KEY trong cài đặt Worker' }), { status: 500, headers: H });

    let body;
    try { body = await req.json(); } catch (e) { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400, headers: H }); }

    const model  = (env && env.GEMINI_MODEL) || DEFAULT_MODEL;
    const maxTok = Math.min(Math.max(parseInt(body.max_tokens, 10) || 1024, 256), 8192);

    // ---------- Anthropic → Gemini ----------
    const contents = (Array.isArray(body.messages) ? body.messages : []).map(m => ({
      role: (m.role === 'assistant') ? 'model' : 'user',
      parts: [{ text:
        (typeof m.content === 'string') ? m.content :
        (Array.isArray(m.content) ? m.content.map(b => (b && b.text) || '').join('\n') : String(m.content || '')) }]
    }));

    const gReq = {
      contents,
      generationConfig: { maxOutputTokens: maxTok, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }
      ]
    };
    if (body.system) gReq.system_instruction = { parts: [{ text: String(body.system) }] };

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
                encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);

    let gRes, gJson;
    try {
      gRes = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gReq) });
      gJson = await gRes.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: 'gemini_fetch_failed', detail: String(e) }), { status: 502, headers: H });
    }

    if (!gRes.ok) {
      return new Response(JSON.stringify({ error: 'gemini_error', status: gRes.status, detail: gJson }), { status: gRes.status, headers: H });
    }

    // ---------- Gemini → Anthropic ----------
    let text = '';
    try {
      const cand  = (gJson.candidates && gJson.candidates[0]) || null;
      const parts = (cand && cand.content && cand.content.parts) || [];
      text = parts.map(p => (p && p.text) || '').join('');
    } catch (e) { text = ''; }

    const out = { content: [{ type: 'text', text: text }], _provider: 'gemini', _model: model };
    return new Response(JSON.stringify(out), { status: 200, headers: H });
  }
};
