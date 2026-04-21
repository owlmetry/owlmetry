import { countryFlag } from "@/lib/country-flag";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  code: string | null | undefined;
}

export function CountryCell({ code }: Props) {
  const f = countryFlag(code);
  if (!f.emoji) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1">
          {f.emoji}
          <span className="font-mono">{f.code}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{f.name}</TooltipContent>
    </Tooltip>
  );
}

export function CountryEmoji({ code }: Props) {
  const f = countryFlag(code);
  if (!f.emoji) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="shrink-0">{f.emoji}</span>
      </TooltipTrigger>
      <TooltipContent>{`${f.name} (${f.code})`}</TooltipContent>
    </Tooltip>
  );
}
