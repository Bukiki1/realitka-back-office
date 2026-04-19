import { PROVIDER_COLORS, PROVIDER_INITIAL, type Provider } from "@/lib/models";

export function ProviderIcon({
  provider,
  size = 14,
}: {
  provider: Provider;
  size?: number;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded font-bold text-white"
      style={{
        width: size,
        height: size,
        background: PROVIDER_COLORS[provider],
        fontSize: Math.max(8, Math.round(size * 0.62)),
        lineHeight: 1,
      }}
      aria-hidden
    >
      {PROVIDER_INITIAL[provider]}
    </span>
  );
}

export function AutoIcon({ size = 14 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded text-white"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, #a855f7, #2563eb)",
      }}
      aria-hidden
    >
      <svg width={size * 0.75} height={size * 0.75} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2l2.4 6.1L21 10l-6 4.5L17 22l-5-3.8L7 22l2-7.5L3 10l6.6-1.9L12 2z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
