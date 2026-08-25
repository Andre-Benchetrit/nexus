export function NexusLogo({ size = "normal", compact = false }: {
  size?: "normal" | "large"; compact?: boolean;
}) {
  return <div className={`nexus-logo ${size}`} aria-label="Nexus — Inteligência FID">
    <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
      <defs><filter id="nexus-glow"><feGaussianBlur stdDeviation="2.2" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path d="M13 49V15l38 34V15" fill="none" stroke="currentColor" strokeWidth="5"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13" cy="15" r="5" /><circle cx="13" cy="49" r="5" />
      <circle cx="51" cy="15" r="5" /><circle cx="51" cy="49" r="5" filter="url(#nexus-glow)" />
    </svg>
    {!compact && <span><strong>NEXUS</strong><small>Inteligência FID</small></span>}
  </div>;
}
