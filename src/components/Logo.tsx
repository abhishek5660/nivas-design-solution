export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="10" fill="#26272b" />
      {/* stylised N built from a cabinet elevation */}
      <path d="M13 36V12h4.2L31 28.4V12h4v24h-4.2L17 19.6V36z" fill="#faf7f2" />
      <rect x="13" y="38" width="22" height="2" rx="1" fill="#b8923f" />
    </svg>
  );
}

export function Logo({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      {!compact && (
        <div className="leading-none">
          <div className={`font-display text-[19px] font-bold tracking-[0.14em] ${light ? 'text-ivory' : 'text-ink'}`}>NIVAS</div>
          <div className={`mt-0.5 text-[9px] font-semibold tracking-[0.32em] ${light ? 'text-gold-soft' : 'text-gold'}`}>DESIGN SOLUTION</div>
        </div>
      )}
    </div>
  );
}
