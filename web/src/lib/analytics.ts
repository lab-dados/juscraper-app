// Analytics via Umami (sem cookies, sem PII). Só envia metadados não sensíveis
// (tribunal, tipo de busca, contagens) — nunca o termo de busca.
//
// Configurado por env (variável do repo, não segredo, pois o website-id é
// público no <script> de qualquer forma):
//   VITE_UMAMI_WEBSITE_ID  (obrigatório para ativar)
//   VITE_UMAMI_SRC         (opcional; default = nuvem oficial do Umami)

const WEBSITE_ID = import.meta.env.VITE_UMAMI_WEBSITE_ID as string | undefined;
const SRC =
  (import.meta.env.VITE_UMAMI_SRC as string | undefined) ?? "https://cloud.umami.is/script.js";

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, unknown>) => void };
  }
}

/** Injeta o script do Umami uma vez, se o website-id estiver configurado. */
export function initAnalytics() {
  if (!WEBSITE_ID || typeof document === "undefined") return;
  if (document.querySelector("script[data-website-id]")) return;
  const s = document.createElement("script");
  s.defer = true;
  s.src = SRC;
  s.setAttribute("data-website-id", WEBSITE_ID);
  document.head.appendChild(s);
}

/** Registra um evento. No-op se o Umami não estiver carregado/configurado. */
export function track(event: string, data?: Record<string, unknown>) {
  try {
    window.umami?.track(event, data);
  } catch {
    /* analytics nunca deve quebrar o app */
  }
}
