import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Clock, Calendar, BarChart2, Settings, Building2, Sun, Moon, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./ThemeProvider";
import { queryClient } from "@/lib/queryClient";

const navItems = [
  { href: "/",         label: "Log Time",  icon: Clock },
  { href: "/weekly",   label: "Weekly",    icon: Calendar },
  { href: "/annual",   label: "Annual",    icon: BarChart2 },
  { href: "/admin",    label: "Admin",     icon: Building2 },
  { href: "/settings", label: "Settings",  icon: Settings },
  { href: "/database", label: "Database",  icon: Database },
];

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  // Listen for file-switch events sent from the native File menu in main.js.
  // When the user switches/creates/opens a file via the menu bar, the main
  // process sends 'files:reloaded'. We clear the query cache so all data
  // reloads from the newly active database.
  useEffect(() => {
    const api = (window as any).timetrackFiles;
    if (!api?.onReloaded) return;
    const unsubscribe = api.onReloaded(() => {
      queryClient.clear();
    });
    return unsubscribe;
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-label="TimeTrack logo">
            <rect width="32" height="32" rx="6" fill="hsl(192 90% 22%)" />
            <circle cx="16" cy="16" r="8" fill="none" stroke="white" strokeWidth="2" />
            <line x1="16" y1="16" x2="16" y2="10" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
            <line x1="16" y1="16" x2="21" y2="16" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className="font-semibold text-[15px] tracking-tight text-sidebar-accent-foreground">
            TimeTrack
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? location === "/" : location.startsWith(href);
            return (
              <Link key={href} href={href}>
                <a
                  data-testid={`nav-${label.toLowerCase().replace(" ", "-")}`}
                  className={cn(
                    "flex items-center gap-3 mx-2 px-3 py-2.5 rounded-md text-sm transition-colors",
                    active
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  )}
                >
                  <Icon size={16} strokeWidth={active ? 2.5 : 2} />
                  {label}
                </a>
              </Link>
            );
          })}
        </nav>

        {/* Theme toggle */}
        <div className="px-5 py-4 border-t border-sidebar-border">
          <button
            onClick={toggle}
            data-testid="button-theme-toggle"
            className="flex items-center gap-2 text-xs text-sidebar-foreground hover:text-sidebar-accent-foreground transition-colors"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
