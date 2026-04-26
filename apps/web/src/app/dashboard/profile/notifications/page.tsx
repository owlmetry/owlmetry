"use client";

// Renders straight from NOTIFICATION_TYPE_META in @owlmetry/shared/preferences,
// so adding a new type there shows up here automatically. The iOS app's
// NotificationPreferencesView.swift hand-maintains a parallel list — when a
// new type lands, mirror it there too or it silently disappears from iOS.
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_META,
  isChannelEnabled,
  type NotificationChannel,
  type NotificationType,
} from "@owlmetry/shared/preferences";
import { useUserPreferences, useUpdateUserPreferences } from "@/hooks/use-user-preferences";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AnimatedPage, StaggerItem } from "@/components/ui/animated-page";

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: "In-app",
  email: "Email",
  ios_push: "iOS push",
};

export default function NotificationPreferencesPage() {
  const prefs = useUserPreferences();
  const update = useUpdateUserPreferences();

  const configurableTypes = NOTIFICATION_TYPES.filter(
    (t) => NOTIFICATION_TYPE_META[t].channels.length > 0,
  );

  async function setEnabled(type: NotificationType, channel: NotificationChannel, value: boolean) {
    await update({
      notifications: {
        types: {
          [type]: { [channel]: value },
        },
      },
    });
  }

  return (
    <AnimatedPage>
      <StaggerItem index={0}>
        <h1 className="text-2xl font-semibold">Notification preferences</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how you receive each kind of notification. Per-project alert frequency for issue
          digests is configured on each project's settings page — it controls how often digests
          batch, while these toggles control which channels deliver them to you.
        </p>
      </StaggerItem>

      {configurableTypes.map((type, i) => {
        const meta = NOTIFICATION_TYPE_META[type];
        return (
          <StaggerItem key={type} index={i + 1}>
            <Card>
              <CardHeader>
                <CardTitle>{meta.label}</CardTitle>
                <p className="text-sm text-muted-foreground">{meta.description}</p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-6">
                  {NOTIFICATION_CHANNELS.filter((c) => meta.channels.includes(c)).map((channel) => {
                    const checked = isChannelEnabled(prefs, type, channel);
                    const id = `pref-${type}-${channel}`;
                    return (
                      <div key={channel} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(value) =>
                            setEnabled(type, channel, value === true)
                          }
                        />
                        <Label htmlFor={id} className="cursor-pointer">
                          {CHANNEL_LABEL[channel]}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </StaggerItem>
        );
      })}
    </AnimatedPage>
  );
}
