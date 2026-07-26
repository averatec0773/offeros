import { getDb } from "@/server/db/client";
import { getProfile } from "@/server/repositories/profile-repo";
import { ProfileClient } from "@/components/profile/profile-client";

export const dynamic = "force-dynamic";

export default function ProfilePage() {
  const profile = getProfile(getDb());
  return <ProfileClient initialProfile={profile} />;
}
