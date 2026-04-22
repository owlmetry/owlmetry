"use client";

import { useState } from "react";
import useSWR from "swr";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, ApiError } from "@/lib/api";
import { ProjectDot } from "@/lib/project-color";

interface Candidate {
  id: string;
  name: string;
  color: string;
}

export function CopyIntegrationDialog({
  targetProjectId,
  provider,
  providerLabel,
  onCopied,
}: {
  targetProjectId: string;
  provider: string;
  providerLabel: string;
  onCopied: () => void;
}) {
  const { data } = useSWR<{ candidates: Candidate[] }>(
    targetProjectId
      ? `/v1/projects/${targetProjectId}/integrations/copy-candidates/${provider}`
      : null,
  );
  const candidates = data?.candidates ?? [];

  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [error, setError] = useState("");
  const [copying, setCopying] = useState(false);

  if (candidates.length === 0) return null;

  async function handleCopy() {
    if (!sourceId) return;
    setError("");
    setCopying(true);
    try {
      await api.post(
        `/v1/projects/${targetProjectId}/integrations/copy-from/${sourceId}`,
        { provider },
      );
      setOpen(false);
      setSourceId("");
      onCopied();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to copy");
    } finally {
      setCopying(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setError("");
          setSourceId("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Copy className="h-4 w-4 mr-1.5" />
          Copy from another project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy {providerLabel} credentials</DialogTitle>
          <DialogDescription>
            Duplicates the chosen project&apos;s credentials into this project. Rotating credentials
            later means editing both copies.
            {provider === "revenuecat" && (
              <> A new webhook secret is generated for this project, so you must add a separate webhook in RevenueCat if you want events delivered here.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="text-xs text-muted-foreground">Copy from</label>
          <Select value={sourceId} onValueChange={setSourceId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    <ProjectDot color={c.color} />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleCopy} disabled={copying || !sourceId}>
            {copying ? "Copying..." : "Copy credentials"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
