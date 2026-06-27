"use client";

import Link from "next/link";
import { NotificationBell } from "./NotificationBell";
import { MessageIcon, ProfileIcon } from "./AuthIcons";
import { useWallet } from "@/lib/wallet";

// The shared connected-user nav cluster: notifications bell, messages, profile.
// Rendered in every nav so social entry points stay consistent. Hidden when no
// wallet is connected. `iconClass` lets a nav tune visibility per breakpoint.
const ICON = "flex items-center justify-center w-[38px] h-[38px] rounded-[10px] border border-line-3 bg-surface text-muted hover:text-accent-text hover:border-line-hover transition-colors";

export function NavUserActions({ messagesHidden }: { messagesHidden?: boolean }) {
  const wallet = useWallet();
  if (!wallet.connected) return null;
  return (
    <>
      <NotificationBell />
      <Link href="/messages" title="Messages" aria-label="Messages" className={`${messagesHidden ? "hidden sm:flex" : "flex"} ${ICON}`}>
        <MessageIcon size={17} />
      </Link>
      <Link href="/profile" title="Your Loop profile" aria-label="Your Loop profile" className={`hidden sm:flex ${ICON}`}>
        <ProfileIcon size={17} />
      </Link>
    </>
  );
}
