import { AppShell } from "@/components/app-shell";

/** Every page inside (studio) gets the sidebar. The login page does not. */
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
