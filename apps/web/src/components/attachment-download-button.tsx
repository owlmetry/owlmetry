"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const ATTACHMENT_UNTRUSTED_WARNING =
  "Attachments come from end-user devices. Treat as untrusted — scan or open in a sandbox before inspecting.";

const ACK_STORAGE_KEY = "owlmetry.attachment-warning-ack";

export function AttachmentUntrustedNotice() {
  return (
    <p className="mt-2 mb-2 text-xs text-muted-foreground">
      ⚠️ {ATTACHMENT_UNTRUSTED_WARNING}
    </p>
  );
}

async function openDownload(attachmentId: string) {
  try {
    const data = await api.get<{ download_url?: { url: string } }>(
      `/v1/attachments/${attachmentId}`
    );
    if (data.download_url?.url) {
      window.open(data.download_url.url, "_blank");
    }
  } catch {
    // best-effort
  }
}

export function AttachmentDownloadButton({
  attachmentId,
  uploadedAt,
}: {
  attachmentId: string;
  uploadedAt: string | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleClick = () => {
    const acked =
      typeof window !== "undefined" &&
      window.sessionStorage.getItem(ACK_STORAGE_KEY) === "1";
    if (acked) {
      void openDownload(attachmentId);
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    try {
      window.sessionStorage.setItem(ACK_STORAGE_KEY, "1");
    } catch {
      // sessionStorage may be unavailable; proceed anyway
    }
    setConfirmOpen(false);
    void openDownload(attachmentId);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleClick}
        disabled={!uploadedAt}
      >
        {uploadedAt ? "Download" : "Pending"}
      </Button>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Download untrusted attachment?</DialogTitle>
            <DialogDescription>
              {ATTACHMENT_UNTRUSTED_WARNING}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>Download anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
