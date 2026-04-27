"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import useSWR from "swr";
import type {
  ProjectResponse,
  AppResponse,
  ReviewResponse,
  ReviewStore,
} from "@owlmetry/shared";
import { useTeam } from "@/contexts/team-context";
import { useReviews, useReviewDetail, useReviewsByCountry, reviewActions } from "@/hooks/use-reviews";
import { useProjectColorMap } from "@/hooks/use-project-colors";
import { timeAgo } from "@/app/dashboard/_components/time-ago";
import { ProjectDot } from "@/lib/project-color";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";
import { Star, MessageCircle, Trash2 } from "lucide-react";
import { countryName, countryFlag } from "@owlmetry/shared/app-store-countries";

const STORE_LABELS: Record<ReviewStore, string> = {
  app_store: "🍎 App Store",
  play_store: "🤖 Play Store",
};

function Stars({ rating, size = "sm" }: { rating: number; size?: "sm" | "lg" }) {
  const px = size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5";
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={
            n <= rating
              ? `${px} fill-amber-400 text-amber-400`
              : `${px} text-muted-foreground/30`
          }
        />
      ))}
    </span>
  );
}

function ReviewCard({
  review,
  projectColor,
  onClick,
}: {
  review: ReviewResponse;
  projectColor: string | undefined;
  onClick: () => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:border-primary/30 transition-colors border-l-4"
      style={{ borderLeftColor: projectColor }}
      onClick={onClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Stars rating={review.rating} />
          <span className="text-xs text-muted-foreground">{timeAgo(review.created_at_in_store)}</span>
        </div>
        {review.title && <p className="text-sm font-semibold leading-snug">{review.title}</p>}
        <p className="text-sm leading-snug line-clamp-3 text-muted-foreground">{review.body}</p>
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span>{STORE_LABELS[review.store]}</span>
          {review.country_code && (
            <span>
              {countryFlag(review.country_code)} {countryName(review.country_code)}
            </span>
          )}
          {review.app_version && <span className="font-mono">v{review.app_version}</span>}
          {review.reviewer_name && <span>by {review.reviewer_name}</span>}
          <span className="font-medium text-foreground/70">{review.app_name}</span>
          {review.developer_response && (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <MessageCircle className="h-3 w-3" />
              Replied
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewDetailModal({
  projectId,
  reviewId,
  open,
  onClose,
  onMutate,
}: {
  projectId: string;
  reviewId: string;
  open: boolean;
  onClose: () => void;
  onMutate: () => void;
}) {
  const { review, isLoading } = useReviewDetail(projectId, reviewId);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!review) return;
    setDeleting(true);
    try {
      await reviewActions.remove(projectId, review.id);
      onMutate();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review</DialogTitle>
        </DialogHeader>
        {isLoading || !review ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Stars rating={review.rating} size="lg" />
              <span className="text-xs text-muted-foreground">
                {new Date(review.created_at_in_store).toLocaleString()}
              </span>
            </div>
            {review.title && <h2 className="text-lg font-semibold">{review.title}</h2>}
            <p className="text-sm whitespace-pre-wrap">{review.body}</p>

            <div className="grid grid-cols-2 gap-3 text-sm border-t pt-3">
              <div>
                <p className="text-xs text-muted-foreground">App</p>
                <p>{review.app_name}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Store</p>
                <p>{STORE_LABELS[review.store]}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Country</p>
                <p>
                  {countryFlag(review.country_code)} {countryName(review.country_code)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Version</p>
                <p className="font-mono text-xs">{review.app_version ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reviewer</p>
                <p>{review.reviewer_name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ingested</p>
                <p className="text-xs">{new Date(review.ingested_at).toLocaleString()}</p>
              </div>
            </div>

            {review.developer_response && (
              <div className="border-t pt-3 space-y-1">
                <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" /> Developer response
                  {review.developer_response_at && (
                    <span className="ml-1">
                      ({new Date(review.developer_response_at).toLocaleString()})
                    </span>
                  )}
                </p>
                <p className="text-sm whitespace-pre-wrap">{review.developer_response}</p>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Hide review
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ByCountryPanel({ projectId, appId }: { projectId: string | undefined; appId: string | undefined }) {
  const { countries, isLoading } = useReviewsByCountry(projectId, appId ? { app_id: appId } : {});
  if (!projectId) return null;
  if (isLoading) return null;
  if (countries.length === 0) return null;
  const top = countries.slice(0, 10);
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-semibold mb-3">Top countries</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {top.map((c) => (
            <div key={c.country_code} className="space-y-0.5">
              <p className="text-xs text-muted-foreground truncate">
                {countryFlag(c.country_code)} {countryName(c.country_code)}
              </p>
              <p className="text-sm font-medium">
                {c.average_rating.toFixed(1)} ★ <span className="text-muted-foreground">({c.review_count})</span>
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ReviewsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentTeam } = useTeam();
  const teamId = currentTeam?.id;

  const { data: projectsData } = useSWR<{ projects: ProjectResponse[] }>(
    teamId ? `/v1/projects?team_id=${teamId}` : null,
  );
  const projects = projectsData?.projects ?? [];
  const projectColorMap = useProjectColorMap(teamId);

  const ALL = "__all__";
  const [projectId, setProjectIdState] = useState(searchParams.get("project_id") ?? ALL);
  const [appId, setAppIdState] = useState(searchParams.get("app_id") ?? ALL);
  const [store, setStore] = useState(searchParams.get("store") ?? ALL);
  const [rating, setRating] = useState(searchParams.get("rating") ?? ALL);
  const [country, setCountry] = useState(searchParams.get("country") ?? ALL);
  const [responseFilter, setResponseFilter] = useState(searchParams.get("response") ?? ALL);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const selectedReviewId = searchParams.get("review_id");

  const selectedProjectId = projectId !== ALL ? projectId : "";

  // Apps for the active project (or all if project not narrowed) — used to filter.
  const { data: appsData } = useSWR<{ apps: AppResponse[] }>(
    teamId
      ? selectedProjectId
        ? `/v1/apps?team_id=${teamId}&project_id=${selectedProjectId}`
        : `/v1/apps?team_id=${teamId}`
      : null,
  );
  const apps = (appsData?.apps ?? []).filter(
    (a) => a.platform === "apple" || a.platform === "android",
  );

  function updateUrl(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === ALL || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(`/dashboard/reviews${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  function setProjectId(v: string) {
    setProjectIdState(v);
    setAppIdState(ALL);
    updateUrl({ project_id: v === ALL ? null : v, app_id: null });
  }

  function setAppId(v: string) {
    setAppIdState(v);
    updateUrl({ app_id: v === ALL ? null : v });
  }

  const { reviews, isLoading, mutate } = useReviews({
    team_id: teamId,
    ...(selectedProjectId ? { project_id: selectedProjectId } : {}),
    ...(appId !== ALL ? { app_id: appId } : {}),
    ...(store !== ALL ? { store: store as ReviewStore } : {}),
    ...(rating !== ALL ? { rating: Number(rating) } : {}),
    ...(country !== ALL ? { country_code: country } : {}),
    ...(responseFilter !== ALL ? { has_developer_response: responseFilter === "yes" } : {}),
    ...(debouncedSearch.trim() ? { search: debouncedSearch.trim() } : {}),
    limit: 100,
  });

  const selectedReview = selectedReviewId ? reviews.find((r) => r.id === selectedReviewId) : null;

  // Derive country options from what's actually present in the by-country aggregate
  // for the active project — keeps the dropdown small and useful.
  const { countries: countryFacets } = useReviewsByCountry(
    selectedProjectId || undefined,
    appId !== ALL ? { app_id: appId } : {},
  );

  return (
    <AnimatedPage className="space-y-4">
      <StaggerItem index={0}>
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Project</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-[200px] h-8 text-xs">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <ProjectDot color={p.color} />
                      {p.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">App</label>
            <Select value={appId} onValueChange={setAppId}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue placeholder="All apps" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All apps</SelectItem>
                {apps.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.platform === "apple" ? "🍎 " : "🤖 "}
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Store</label>
            <Select value={store} onValueChange={(v) => { setStore(v); updateUrl({ store: v === ALL ? null : v }); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All stores</SelectItem>
                <SelectItem value="app_store">🍎 App Store</SelectItem>
                <SelectItem value="play_store">🤖 Play Store</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Rating</label>
            <Select value={rating} onValueChange={(v) => { setRating(v); updateUrl({ rating: v === ALL ? null : v }); }}>
              <SelectTrigger className="w-[110px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                {[5, 4, 3, 2, 1].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} ★
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Country</label>
            <Select value={country} onValueChange={(v) => { setCountry(v); updateUrl({ country: v === ALL ? null : v }); }}>
              <SelectTrigger className="w-[180px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All countries</SelectItem>
                {countryFacets.map((c) => (
                  <SelectItem key={c.country_code} value={c.country_code}>
                    {countryFlag(c.country_code)} {countryName(c.country_code)} ({c.review_count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Reply</label>
            <Select value={responseFilter} onValueChange={(v) => { setResponseFilter(v); updateUrl({ response: v === ALL ? null : v }); }}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any</SelectItem>
                <SelectItem value="yes">With reply</SelectItem>
                <SelectItem value="no">No reply</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 flex-1 min-w-[180px] max-w-[320px]">
            <label className="text-xs text-muted-foreground">Search</label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, body, reviewer..."
              className="h-8 text-xs"
            />
          </div>
        </div>
      </StaggerItem>

      {selectedProjectId && (
        <StaggerItem index={1}>
          <ByCountryPanel projectId={selectedProjectId} appId={appId !== ALL ? appId : undefined} />
        </StaggerItem>
      )}

      <StaggerItem index={2}>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : reviews.length === 0 ? (
          <div className="text-center py-12">
            <Star className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground">No reviews yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Apple reviews are pulled daily from every storefront via the iTunes RSS feed for each Apple app with a
              bundle ID. The first sync may take a couple of minutes after you create an app — give it a moment.
              Play Store ingest is coming in a future phase.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {reviews.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                projectColor={projectColorMap.get(r.project_id)}
                onClick={() => updateUrl({ review_id: r.id })}
              />
            ))}
          </div>
        )}
      </StaggerItem>

      {selectedReviewId && selectedReview && (
        <ReviewDetailModal
          projectId={selectedReview.project_id}
          reviewId={selectedReviewId}
          open={!!selectedReviewId}
          onClose={() => updateUrl({ review_id: null })}
          onMutate={() => mutate()}
        />
      )}
    </AnimatedPage>
  );
}
