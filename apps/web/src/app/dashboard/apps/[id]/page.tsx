"use client";

import { useState, useMemo } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { ArrowLeft, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/copy-button";
import { useAppUsers } from "@/hooks/use-app-users";
import type { AppResponse, AppUsersQueryParams } from "@owlmetry/shared";

export default function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: app } = useSWR<AppResponse>(`/v1/apps/${id}`);

  const [search, setSearch] = useState("");
  const [anonymousFilter, setAnonymousFilter] = useState("");

  const filters = useMemo<AppUsersQueryParams>(() => {
    const f: AppUsersQueryParams = {};
    if (search) f.search = search;
    if (anonymousFilter && anonymousFilter !== "all") f.is_anonymous = anonymousFilter;
    return f;
  }, [search, anonymousFilter]);

  const { users, isLoading, isLoadingMore, hasMore, loadMore } = useAppUsers(id, filters);

  if (!app) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/dashboard/projects/${app.project_id}`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">{app.name}</h1>
          <p className="text-sm text-muted-foreground">
            {app.platform}{app.bundle_id ? ` \u00B7 ${app.bundle_id}` : ""}
          </p>
        </div>
      </div>

      {/* App info */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {app.client_key && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Client Key:</span>
            <code className="bg-muted px-1.5 py-0.5 text-xs">
              {app.client_key.slice(0, 20)}...
            </code>
            <CopyButton text={app.client_key} />
          </div>
        )}
        <Link href={`/dashboard/events?app_id=${id}`}>
          <Button variant="outline" size="sm">View Events</Button>
        </Link>
      </div>

      {/* Users section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-medium">Users</h2>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Search</label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search user IDs..."
                className="w-[220px] h-8 text-xs pl-7"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Type</label>
            <Select value={anonymousFilter} onValueChange={setAnonymousFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="false">Real users</SelectItem>
                <SelectItem value="true">Anonymous</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Auto-refresh indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Auto-refreshing every 30s
        </div>

        {/* Users table */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading users...</p>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">No users found</p>
            <p className="text-xs mt-1">Users appear here after events are ingested</p>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User ID</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead className="w-[100px]">Claims</TableHead>
                    <TableHead className="w-[160px]">First Seen</TableHead>
                    <TableHead className="w-[160px]">Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-mono text-xs py-1.5">
                        <Link
                          href={`/dashboard/events?app_id=${id}&user_id=${user.user_id}`}
                          className="hover:underline"
                        >
                          {user.user_id}
                        </Link>
                      </TableCell>
                      <TableCell className="py-1.5">
                        {user.is_anonymous ? (
                          <Badge variant="secondary" className="text-xs">anon</Badge>
                        ) : (
                          <Badge variant="default" className="text-xs">real</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs py-1.5">
                        {user.claimed_from?.length ?? 0}
                      </TableCell>
                      <TableCell className="text-xs py-1.5" title={user.first_seen_at}>
                        {new Date(user.first_seen_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs py-1.5" title={user.last_seen_at}>
                        {new Date(user.last_seen_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading..." : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
