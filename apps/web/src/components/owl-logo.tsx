export function OwlLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className}>
      <path
        d="M6 13 L4 7 L2 3 L8 6 L16 4 L24 6 L30 3 L28 7 L26 13 L25 22 L21 27 L16 24 L11 27 L7 22 Z"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <circle cx="11" cy="13" r="5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.05" />
      <circle cx="11" cy="13" r="2.5" fill="currentColor" />
      <circle cx="21" cy="13" r="5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.05" />
      <circle cx="21" cy="13" r="2.5" fill="currentColor" />
      <path
        d="M14 20 L16 23 L18 20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
