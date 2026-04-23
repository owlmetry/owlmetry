"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RoleBadge } from "@/components/badges/role-badge";
import { OwlLogo } from "@/components/owl-logo";
import type {
  TeamInvitationPublicResponse,
  AcceptInvitationResponse,
  MeResponse,
} from "@owlmetry/shared";
import { formatFullDate } from "@/lib/format-date";

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <AcceptInvitationContent />
    </Suspense>
  );
}

function AcceptInvitationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [invite, setInvite] = useState<TeamInvitationPublicResponse | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [authUser, setAuthUser] = useState<MeResponse | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [autoAcceptAttempted, setAutoAcceptAttempted] = useState(false);

  // Fetch invite info + check auth
  useEffect(() => {
    if (!token) {
      setInviteError("No invitation token provided");
      return;
    }

    api
      .get<TeamInvitationPublicResponse>(`/v1/invites/${token}`)
      .then(setInvite)
      .catch((err) => {
        setInviteError(
          err instanceof ApiError ? err.message : "Failed to load invitation"
        );
      });

    api
      .get<MeResponse>("/v1/auth/me")
      .then((me) => {
        setAuthUser(me);
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthChecked(true);
      });
  }, [token]);

  // Auto-accept when authenticated user's email matches the invite
  useEffect(() => {
    if (!invite || !authUser || !token || autoAcceptAttempted || accepted || accepting) return;
    if (authUser.user.email !== invite.email) return;

    setAutoAcceptAttempted(true);
    handleAccept();
  }, [invite, authUser]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAccept() {
    if (!token) return;
    setAcceptError("");
    setAccepting(true);
    try {
      await api.post<AcceptInvitationResponse>("/v1/invites/accept", { token });
      setAccepted(true);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      setAcceptError(
        err instanceof ApiError ? err.message : "Failed to accept invitation"
      );
    } finally {
      setAccepting(false);
    }
  }

  function handleSignIn() {
    const redirectPath = `/invite/accept?token=${token}`;
    router.push(`/login?redirect=${encodeURIComponent(redirectPath)}`);
  }

  function handleSignInDifferent() {
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    handleSignIn();
  }

  return (
    <div className="flex min-h-screen">
      {/* Branded panel — matches login page */}
      <div
        className="hidden lg:flex lg:w-[45%] relative overflow-hidden items-center justify-center"
        style={{ background: "oklch(0.12 0.015 55)" }}
      >
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: `linear-gradient(oklch(0.555 0.163 48.998) 1px, transparent 1px),
              linear-gradient(90deg, oklch(0.555 0.163 48.998) 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 45%, oklch(0.555 0.163 48.998 / 0.12) 0%, transparent 65%)",
          }}
        />
        <div className="relative z-10 text-center space-y-6 px-12 animate-fade-in">
          <div className="text-primary mx-auto">
            <OwlLogo className="h-36 w-36 mx-auto" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white/90 tracking-tight">
              OwlMetry
            </h1>
            <p className="text-white/40 mt-2 text-sm">
              Self-hosted metrics tracking for mobile apps
            </p>
          </div>
        </div>
      </div>

      {/* Content panel */}
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="lg:hidden flex items-center gap-2.5 justify-center mb-8">
            <OwlLogo className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold tracking-tight">OwlMetry</span>
          </div>

          {inviteError ? (
            <Card>
              <CardContent className="pt-6 text-center space-y-4">
                <p className="text-muted-foreground">{inviteError}</p>
                <Button variant="outline" onClick={() => router.push("/dashboard")}>
                  Go to Dashboard
                </Button>
              </CardContent>
            </Card>
          ) : !invite ? (
            <div className="text-center space-y-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Loading invitation...</p>
            </div>
          ) : accepted ? (
            <Card>
              <CardContent className="pt-8 pb-8 text-center space-y-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Check className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-medium">
                    You&apos;ve joined {invite.team_name}!
                  </p>
                  <p className="text-sm text-muted-foreground">Redirecting to dashboard...</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <div className="space-y-1.5">
                <h2 className="text-2xl font-semibold tracking-tight">
                  You&apos;re invited
                </h2>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{invite.invited_by_name}</span>{" "}
                  invited you to join a team on OwlMetry
                </p>
              </div>

              <Card>
                <CardContent className="pt-6 space-y-6">
                  <div className="text-center space-y-1.5">
                    <p className="text-2xl font-semibold tracking-tight">{invite.team_name}</p>
                    <p className="text-muted-foreground">
                      as <RoleBadge role={invite.role} size="md" />
                    </p>
                  </div>

                  {acceptError && (
                    <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive text-center">
                      {acceptError}
                    </div>
                  )}

                  {!authChecked ? (
                    <div className="flex items-center justify-center gap-2 py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        Checking authentication...
                      </p>
                    </div>
                  ) : authUser ? (
                    authUser.user.email === invite.email && accepting ? (
                      <div className="flex items-center justify-center gap-2 py-2">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <p className="text-sm text-muted-foreground">
                          Accepting invitation...
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-center text-muted-foreground">
                          Signed in as {authUser.user.email}
                        </p>
                        {authUser.user.email !== invite.email && (
                          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 px-3 py-2.5 text-sm text-yellow-600 dark:text-yellow-400 text-center">
                            This invitation was sent to {invite.email}. You&apos;re
                            signed in as {authUser.user.email}.
                          </div>
                        )}
                        <Button
                          className="w-full"
                          onClick={handleAccept}
                          disabled={accepting || authUser.user.email !== invite.email}
                        >
                          {accepting ? "Accepting..." : "Accept Invitation"}
                        </Button>
                        {authUser.user.email !== invite.email && (
                          <Button
                            variant="outline"
                            className="w-full"
                            onClick={handleSignInDifferent}
                          >
                            Sign in as {invite.email}
                          </Button>
                        )}
                      </div>
                    )
                  ) : (
                    <Button className="w-full" onClick={handleSignIn}>
                      Sign in to accept
                    </Button>
                  )}

                  <p className="text-xs text-muted-foreground text-center border-t pt-4">
                    Expires{" "}
                    {formatFullDate(invite.expires_at)}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
