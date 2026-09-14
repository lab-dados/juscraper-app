// Links externos reusados pela UI.
export const LABDADOS_URL =
  "https://labdados-frontend.livelydesert-3e3e3dd8.brazilsouth.azurecontainerapps.io/";

export const COLAB_URL =
  "https://colab.research.google.com/github/lab-dados/juscraper-app/blob/main/notebooks/juscraper_colab.ipynb";

export const REPO_URL = "https://github.com/lab-dados/juscraper-app";

// Limite de páginas que a ferramenta web baixa por busca.
export const MAX_PAGINAS = 100;

// Aba Processos (DataJud). A API devolve até 10.000 processos por requisição;
// o app usa páginas menores porque tudo passa pelo proxy e fica na memória do
// navegador. Com movimentações cada processo pesa ~25 KB (TJSP, usucapião,
// 2024: ~108 movimentações por processo); sem elas, ~0,6 KB. Os segundos por
// requisição foram medidos na API pública e variam bastante com a carga.
export const DATAJUD = {
  comMovs: { tamanhoPagina: 500, maxProcessos: 5000, segPorPagina: 16 },
  semMovs: { tamanhoPagina: 1000, maxProcessos: 10000, segPorPagina: 8 },
} as const;
