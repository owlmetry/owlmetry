"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface MetricDocsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  documentation: string | null;
}

export function MetricDocsSheet({ open, onOpenChange, name, documentation }: MetricDocsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{name} — Documentation</SheetTitle>
        </SheetHeader>
        <div className="mt-4 prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
          {documentation || "No documentation available."}
        </div>
      </SheetContent>
    </Sheet>
  );
}
