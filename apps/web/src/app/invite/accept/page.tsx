"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { OwlLogo } from "@/components/owl-logo";
import type {
  TeamInvitationPublicResponse,
  AcceptInvitationResponse,
  MeResponse,
} from "@owlmetry/shared";

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
    // Clear cookie and redirect to login
    document.cookie = "token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    handleSignIn();
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2.5 justify-center">
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
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-muted-foreground">Loading invitation...</p>
            </CardContent>
          </Card>
        ) : accepted ? (
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <p className="text-lg font-medium">
                You&apos;ve joined {invite.team_name}!
              </p>
              <p className="text-muted-foreground">Redirecting to dashboard...</p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader className="text-center">
              <CardTitle>Team Invitation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center space-y-2">
                <p>
                  <span className="font-medium">{invite.invited_by_name}</span>{" "}
                  invited you to join
                </p>
                <p className="text-2xl font-semibold">{invite.team_name}</p>
                <p className="text-muted-foreground">
                  as <Badge variant="secondary">{invite.role}</Badge>
                </p>
              </div>

              {acceptError && (
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive text-center">
                  {acceptError}
                </div>
              )}

              {!authChecked ? (
                <p className="text-center text-muted-foreground text-sm">
                  Checking authentication...
                </p>
              ) : authUser ? (
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
              ) : (
                <Button className="w-full" onClick={handleSignIn}>
                  Sign in to accept
                </Button>
              )}

              <p className="text-xs text-muted-foreground text-center">
                Expires{" "}
                {new Date(invite.expires_at).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
