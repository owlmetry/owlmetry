import { Badge } from "@/components/ui/badge";

interface UserTypeBadgeProps {
  isAnonymous: boolean;
  size?: "sm" | "md";
}

export function UserTypeBadge({ isAnonymous, size = "sm" }: UserTypeBadgeProps) {
  return isAnonymous ? (
    <Badge variant="secondary" size={size}>👻 anon</Badge>
  ) : (
    <Badge variant="default" size={size}>👤 real</Badge>
  );
}
