"use client";

import { useState } from "react";
import { UserPlus, UserCheck, Loader2 } from "lucide-react";
import { toggleFollow } from "@/app/socialActions";

export default function FollowButton({
  token,
  targetUserId,
  initialFollowing,
}: {
  token: string;
  targetUserId: string;
  initialFollowing: boolean;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    const res = await toggleFollow(token, targetUserId);
    if (res.ok) setFollowing(res.isFollowing);
    setBusy(false);
  };

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-bold text-sm transition-all disabled:opacity-60 ${
        following
          ? "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          : "bg-primary text-white hover:bg-primary-hover"
      }`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : following ? <UserCheck className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
      {following ? "Siguiendo" : "Seguir"}
    </button>
  );
}
