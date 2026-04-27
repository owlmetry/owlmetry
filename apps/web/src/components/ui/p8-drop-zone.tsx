"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY_ID_FROM_FILENAME = /^AuthKey_([A-Za-z0-9]+)\.p8$/;

export interface P8Parsed {
  contents: string;
  keyIdFromFilename: string | null;
  filename: string;
}

interface P8DropZoneProps {
  onParsed: (parsed: P8Parsed) => void;
  className?: string;
}

export function P8DropZone({ onParsed, className }: P8DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [loadedFilename, setLoadedFilename] = useState("");

  function handleFiles(files: FileList | File[]) {
    setError("");
    const list = Array.from(files);
    if (list.length === 0) return;
    if (list.length > 1) {
      setError("Drop a single .p8 file.");
      return;
    }
    const file = list[0];
    if (!file.name.toLowerCase().endsWith(".p8")) {
      setError(`Expected a .p8 file, got ${file.name}.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const contents = String(reader.result ?? "");
      const match = file.name.match(KEY_ID_FROM_FILENAME);
      const keyIdFromFilename = match ? match[1] : null;
      setLoadedFilename(file.name);
      onParsed({ contents, keyIdFromFilename, filename: file.name });
    };
    reader.onerror = () => setError("Failed to read file.");
    reader.readAsText(file);
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "w-full rounded-md border border-dashed px-4 py-5 text-center transition-colors",
          "hover:bg-muted/40 cursor-pointer",
          dragOver
            ? "border-primary bg-muted/60"
            : loadedFilename
              ? "border-emerald-600/40 bg-emerald-950/10"
              : "border-muted-foreground/40 bg-muted/20",
        )}
      >
        <div className="flex items-center justify-center gap-2 text-sm">
          {loadedFilename ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="font-mono text-xs">{loadedFilename}</span>
              <span className="text-muted-foreground">— loaded, drop another to replace</span>
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span>
                Drop your <span className="font-mono">AuthKey_*.p8</span> here, or click to browse
              </span>
            </>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Auto-fills the private key and Key ID below.
        </p>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".p8"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}
