export function Logo({ size = 36, version = "v1.0" }: { size?: number; version?: string }) {
  return (
    <div className="flex items-center gap-3 select-none">
      <div
        className="grid place-items-center rounded-lg shadow-soft"
        style={{
          width: size,
          height: size,
          background: "linear-gradient(135deg, #d97706, #b45309)",
        }}
      >
        <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M3 11L12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V11z"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="text-base font-semibold text-white tracking-tight">Realitka</span>
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-accent uppercase tracking-wider">
            {version}
          </span>
        </div>
        <div className="text-[11px] text-text-muted">Back Office Agent</div>
      </div>
    </div>
  );
}
