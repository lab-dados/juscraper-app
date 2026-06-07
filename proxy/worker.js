/**
 * Proxy CORS fino para o juscraper-app.
 *
 * O navegador nao consegue chamar os sites dos tribunais direto (eles nao
 * mandam cabecalhos CORS). Este Worker fica no meio: recebe a requisicao do
 * browser, repassa pro tribunal e devolve a resposta com `Access-Control-Allow-Origin`.
 *
 * Por que renomear cabecalhos: `Cookie`, `Set-Cookie`, `User-Agent`, `Host`,
 * `Referer` e `Origin` sao "forbidden headers" — o fetch/XHR do navegador NAO
 * deixa o JS le-los nem escreve-los. Entao o glue Python manda:
 *    X-Target-URL : URL real do tribunal
 *    X-Cookie     : cookies do jar do requests (vira `Cookie` no upstream)
 *    X-UA         : User-Agent desejado   (vira `User-Agent` no upstream)
 * e este Worker devolve:
 *    X-Set-Cookie : todos os Set-Cookie do upstream (\n-separados)
 *    X-Final-Url  : URL final apos redirects
 *    X-Upstream-Status : status HTTP real do upstream
 *
 * O Worker segue redirects MANUALMENTE, acumulando cookies ao longo da cadeia,
 * para imitar o comportamento do `requests.Session` (o fetch do Worker nao e
 * cookie-aware sozinho).
 */

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 8;

// Cabecalhos que NAO devem ser repassados ao upstream.
const HOP_BY_HOP = new Set([
  "host", "origin", "referer", "connection", "content-length",
  "x-target-url", "x-cookie", "x-ua",
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
  "Access-Control-Expose-Headers": "X-Set-Cookie, X-Final-Url, X-Upstream-Status",
};

/** Parseia "a=1; b=2" -> Map. */
function parseCookieHeader(value) {
  const jar = new Map();
  if (!value) return jar;
  for (const part of value.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (name) jar.set(name, val);
  }
  return jar;
}

/** Pega o "name=value" de um cabecalho Set-Cookie e guarda no jar. */
function applySetCookie(jar, setCookieValue) {
  const first = setCookieValue.split(";")[0];
  const idx = first.indexOf("=");
  if (idx === -1) return;
  const name = first.slice(0, idx).trim();
  const val = first.slice(idx + 1).trim();
  if (name) jar.set(name, val);
}

function jarToCookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function b64encodeUtf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function buildUpstreamHeaders(req, jar, ua) {
  const headers = new Headers();
  for (const [key, value] of req.headers) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (key.toLowerCase().startsWith("cf-")) continue;
    if (key.toLowerCase().startsWith("sec-")) continue;
    headers.set(key, value);
  }
  const cookie = jarToCookieHeader(jar);
  if (cookie) headers.set("Cookie", cookie);
  headers.set("User-Agent", ua);
  return headers;
}

/** Coleta TODOS os Set-Cookie de uma Response (Cloudflare expoe via getSetCookie). */
function collectSetCookies(resp) {
  if (typeof resp.headers.getSetCookie === "function") {
    return resp.headers.getSetCookie();
  }
  const raw = resp.headers.get("set-cookie");
  return raw ? [raw] : [];
}

function resolveTarget(req, url) {
  const fromHeader = req.headers.get("X-Target-URL");
  if (fromHeader) return fromHeader;
  const fromQuery = url.searchParams.get("url");
  if (fromQuery) return fromQuery;
  return null;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

/**
 * Cria um Gist (não listado) com o notebook da busca e devolve a URL do Colab.
 * Requer o secret GITHUB_GIST_TOKEN (PAT com escopo `gist`).
 * Body: { filename, content, description? }
 */
async function handleGist(request, env) {
  const token = env && env.GITHUB_GIST_TOKEN;
  if (!token) {
    return jsonResponse({ error: "GITHUB_GIST_TOKEN não configurado no Worker." }, 501);
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }
  if (!body.filename || !body.content) {
    return jsonResponse({ error: "filename e content são obrigatórios." }, 400);
  }

  const gh = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "juscraper-app",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: body.description || "Busca gerada pela ferramenta juscraper-app",
      public: false, // gist não listado (acessível só por URL)
      files: { [body.filename]: { content: body.content } },
    }),
  });
  const data = await gh.json();
  if (!gh.ok) {
    return jsonResponse({ error: data.message || "Falha ao criar o Gist." }, 502);
  }
  const owner = data.owner && data.owner.login;
  const colabUrl = `https://colab.research.google.com/gist/${owner}/${data.id}/${body.filename}`;
  return jsonResponse({ colabUrl, gistUrl: data.html_url });
}

async function handle(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);

  if (url.pathname === "/gist" && request.method === "POST") {
    return handleGist(request, env);
  }

  if (url.pathname === "/" && !resolveTarget(request, url)) {
    return new Response(
      "juscraper-app CORS proxy. Use header X-Target-URL ou ?url=<destino>.",
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "text/plain" } }
    );
  }

  let target = resolveTarget(request, url);
  if (!target) {
    return new Response("Missing X-Target-URL", { status: 400, headers: CORS_HEADERS });
  }

  const ua = request.headers.get("X-UA") || DEFAULT_UA;
  const jar = parseCookieHeader(request.headers.get("X-Cookie"));
  const collectedSetCookies = [];

  // Corpo so existe em metodos com payload; bufferiza pra poder reusar em redirects.
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const bodyBuffer = hasBody ? await request.arrayBuffer() : undefined;

  let method = request.method;
  let currentUrl = target;
  let finalResp = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers = buildUpstreamHeaders(request, jar, ua);
    let resp;
    try {
      resp = await fetch(currentUrl, {
        method,
        headers,
        body: hasBody ? bodyBuffer : undefined,
        redirect: "manual",
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ proxyError: String(err), url: currentUrl }),
        { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    for (const sc of collectSetCookies(resp)) {
      collectedSetCookies.push(sc);
      applySetCookie(jar, sc);
    }

    const isRedirect = resp.status >= 300 && resp.status < 400 && resp.headers.get("location");
    if (isRedirect && hop < MAX_REDIRECTS) {
      currentUrl = new URL(resp.headers.get("location"), currentUrl).toString();
      // Redirects 301/302/303 viram GET (semantica de navegador); 307/308 preservam.
      if (resp.status !== 307 && resp.status !== 308) method = "GET";
      continue;
    }
    finalResp = resp;
    break;
  }

  // Monta resposta pro browser, removendo headers que confundem a camada cliente.
  const outHeaders = new Headers(CORS_HEADERS);
  for (const [key, value] of finalResp.headers) {
    const lk = key.toLowerCase();
    if (["content-encoding", "content-length", "transfer-encoding", "set-cookie", "connection"].includes(lk)) {
      continue;
    }
    // Descarta os CORS do upstream: alguns tribunais (ex.: a API do TJES) ecoam
    // o proprio `Access-Control-Allow-Origin` (as vezes um origin de dev como
    // http://127.0.0.1:5173) + `Allow-Credentials: true`. Se copiados, eles
    // sobrescrevem o nosso `Access-Control-Allow-Origin: *` e o navegador bloqueia
    // a resposta (net::ERR_FAILED / "Failed to fetch"). O nosso CORS sempre vence.
    if (lk.startsWith("access-control-")) {
      continue;
    }
    outHeaders.set(key, value);
  }
  if (collectedSetCookies.length) {
    // base64(UTF-8): cabecalho nao pode conter newline, e Set-Cookie e multivalor.
    outHeaders.set("X-Set-Cookie", b64encodeUtf8(collectedSetCookies.join("\n")));
  }
  outHeaders.set("X-Final-Url", currentUrl);
  outHeaders.set("X-Upstream-Status", String(finalResp.status));

  const buf = await finalResp.arrayBuffer();
  return new Response(buf, { status: finalResp.status, headers: outHeaders });
}

export default {
  fetch: handle,
};
