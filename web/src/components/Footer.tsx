const LINKS = [
  { label: "Repositório (GitHub)", href: "https://github.com/jtrecenti/juscraper-app" },
  { label: "Reportar problema (issues)", href: "https://github.com/jtrecenti/juscraper-app/issues" },
  { label: "Pacote juscraper", href: "https://github.com/jtrecenti/juscraper" },
  { label: "LabDados FGV", href: "https://labdados-frontend.livelydesert-3e3e3dd8.brazilsouth.azurecontainerapps.io/" },
];

export function Footer() {
  return (
    <footer className="mt-10 border-t border-fgv-100 bg-white">
      <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-fgv-500">
        <p>
          Ferramenta mantida pelo <strong className="text-fgv-700">LabDados</strong>, da
          FGV Direito SP. Construída sobre o pacote de código aberto{" "}
          <a className="text-accent hover:underline" href="https://github.com/jtrecenti/juscraper" target="_blank" rel="noreferrer">
            juscraper
          </a>
          .
        </p>
        <nav className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="text-fgv-600 hover:text-accent hover:underline"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <p className="mt-3 text-xs text-fgv-400">
          Uso responsável: respeite os termos dos tribunais. Os dados são públicos e
          processados localmente no seu navegador.
        </p>
      </div>
    </footer>
  );
}
