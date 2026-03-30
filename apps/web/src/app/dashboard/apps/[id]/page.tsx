"use client";

import { useEffect } from "react";
import { useParams, usePathname } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { useBreadcrumbs } from "@/contexts/breadcrumb-context";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/copy-button";
import type { AppResponse } from "@owlmetry/shared";

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { data: app } = useSWR<AppResponse>(`/v1/apps/${id}`);
  const { data: project } = useSWR<{ name: string }>(
    app?.project_id ? `/v1/projects/${app.project_id}` : null,
  );

  useEffect(() => {
    if (app?.name && project?.name) {
      setBreadcrumbs(
        [
          { label: "Projects", href: "/dashboard/projects" },
          { label: project.name, href: `/dashboard/projects/${app.project_id}` },
          { label: app.name },
        ],
        pathname,
      );
    }
  }, [app?.name, app?.project_id, project?.name, pathname, setBreadcrumbs]);

  if (!app) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">{app.name}</h1>
        <p className="text-sm text-muted-foreground">
          {app.platform}{app.bundle_id ? ` \u00B7 ${app.bundle_id}` : ""}
        </p>
      </div>

      {/* App info */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {app.client_secret && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Client Secret:</span>
            <code className="bg-muted px-1.5 py-0.5 text-xs">
              {app.client_secret.slice(0, 20)}...
            </code>
            <CopyButton text={app.client_secret} />
          </div>
        )}
        <Link href={`/dashboard/events?app_id=${id}`}>
          <Button variant="outline" size="sm">View Events</Button>
        </Link>
        <Link href={`/dashboard/users?app_id=${id}`}>
          <Button variant="outline" size="sm">View Users</Button>
        </Link>
      </div>
    </div>
  );
}
