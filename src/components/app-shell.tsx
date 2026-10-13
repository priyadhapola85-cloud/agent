"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  CheckSquare,
  Clapperboard,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  PenSquare,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { api } from "@/lib/client/api";
import { cx } from "./ui";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/characters/new", label: "Create AI Character", icon: Sparkles },
  { href: "/characters", label: "Character Library", icon: Users },
  { href: "/content/new", label: "Create Fashion Content", icon: PenSquare },
  { href: "/studio/images", label: "Image Studio", icon: ImageIcon },
  { href: "/studio/videos", label: "Video Studio", icon: Clapperboard },
  { href: "/review", label: "Review & Approval", icon: CheckSquare },
  { href: "/history", label: "Generation History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/characters") return pathname === "/characters" || (/^\/characters\/(?!new)/.test(pathname));
  if (href === "/content/new") return pathname.startsWith("/content");
  return pathname.startsWith(href);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    // Full reload on purpose so no studio data stays in memory after logout.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/login";
  }

  const nav = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          className={cx(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
            isActive(pathname, href) ? "bg-ink text-white" : "text-ink/80 hover:bg-ink/5",
          )}
        >
          <Icon className="h-4 w-4" /> {label}
        </Link>
      ))}
      <button onClick={logout} className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-ink/5">
        <LogOut className="h-4 w-4" /> Log out
      </button>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface p-4 lg:flex">
        <Link href="/" className="mb-6 px-3">
          <span className="font-display text-xl">Atelier</span>
          <span className="block text-[11px] uppercase tracking-[0.2em] text-muted">Fashion AI Studio</span>
        </Link>
        {nav}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
          <span className="font-display text-lg">Atelier</span>
          <button aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
        </header>
        {open && (
          <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setOpen(false)}>
            <div className="flex h-full w-72 flex-col bg-surface p-4" onClick={(e) => e.stopPropagation()}>
              <button aria-label="Close menu" className="mb-4 self-end" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </button>
              {nav}
            </div>
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
