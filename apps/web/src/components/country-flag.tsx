import { countryFlag } from "@/lib/country-flag";

interface Props {
  code: string | null | undefined;
}

export function CountryCell({ code }: Props) {
  const f = countryFlag(code);
  if (!f.emoji) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-1" title={f.name}>
      {f.emoji}
      <span className="font-mono">{f.code}</span>
    </span>
  );
}

export function CountryEmoji({ code }: Props) {
  const f = countryFlag(code);
  if (!f.emoji) return null;
  return (
    <span className="shrink-0" title={`${f.name} (${f.code})`}>
      {f.emoji}
    </span>
  );
}
