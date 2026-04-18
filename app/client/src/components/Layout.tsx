import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { Clock, Calendar, BarChart2, Settings, Building2, Sun, Moon,
         FolderOpen, FilePlus, ChevronDown, Check, FolderInput } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "./ThemeProvider";
import { listFiles, switchFile, createFile, openFile, isElectron, type FileEntry } from "@/lib/files";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { href: "/",        label: "Log Time", icon: Clock },
  { href: "/weekly",  label: "Weekly",   icon: Calendar },
  { href: "/annual",  label: "Annual",   icon: BarChart2 },
  { href: "/admin",   label: "Admin",    icon: Building2 },
  { href: "/settings",label: "Settings", icon: Settings },
];

// ─── New File dialog ──────────────────────────────────────────────────────────
function NewFileDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handleCreate() {
    if (!name.trim()) { setError("Name is required"); return; }
    setBusy(true);
    const result = await createFile(name.trim());
    setBusy(false);
    if (result?.canceled) { onClose(); return; }
    if (result?.error) { setError(result.error); return; }
    toast({ title: `Switched to "${result?.active?.name}"` });
    // Invalidate all queries so the UI reloads from the new DB
    queryClient.clear();
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg shadow-xl w-80 p-5">
        <h2 className="text-sm font-semibold mb-4">New Database File</h2>
        <label className="text-xs text-muted-foreground block mb-1">File name</label>
        <input
          ref={inputRef}
          value={name}
          onChange={e => { setName(e.target.value); setError(""); }}
          onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
          placeholder="e.g. Client A, Personal, 2026"
          className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mb-1"
        />
        {error && <p className="text-xs text-destructive mb-2">{error}</p>}
        <p className="text-xs text-muted-foreground mb-4">
          You'll choose the folder where the <code>.db</code> file is saved.
        </p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded-md border text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Creating…" : "Choose folder →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── File dropdown ────────────────────────────────────────────────────────────
function FileMenu() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  async function reload() {
    setFiles(await listFiles());
  }

  useEffect(() => { if (isElectron()) reload(); }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  if (!isElectron()) return null;

  const active = files[0];

  async function handleSwitch(f: FileEntry) {
    setOpen(false);
    if (f.path === active?.path) return;
    const result = await switchFile(f.path);
    if (result?.error) { toast({ title: "Could not switch file", description: result.error, variant: "destructive" }); return; }
    toast({ title: `Switched to "${f.name}"` });
    queryClient.clear();
    await reload();
  }

  async function handleOpen() {
    setOpen(false);
    const result = await openFile();
    if (result?.canceled) return;
    if (result?.error) { toast({ title: "Could not open file", description: result.error, variant: "destructive" }); return; }
    toast({ title: `Opened "${result?.active?.name}"` });
    queryClient.clear();
    await reload();
  }

  return (
    <>
      <div ref={menuRef} className="relative px-3 mb-1">
        <button
          onClick={() => setOpen(v => !v)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
        >
          <FolderOpen size={15} strokeWidth={2} />
          <span className="flex-1 text-left truncate">{active?.name ?? "Default"}</span>
          <ChevronDown size={13} className={cn("transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="absolute left-3 right-3 top-full mt-1 z-50 bg-popover border rounded-md shadow-lg py-1 text-sm">
            {/* Known files */}
            {files.length > 0 && (
              <>
                <div className="px-3 py-1 text-xs text-muted-foreground font-medium">Files</div>
                {files.map(f => (
                  <button
                    key={f.path}
                    onClick={() => handleSwitch(f)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                  >
                    <Check size={13} className={cn("shrink-0", f.path === active?.path ? "opacity-100 text-primary" : "opacity-0")} />
                    <span className="flex-1 truncate">{f.name}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
              </>
            )}

            {/* Actions */}
            <button
              onClick={() => { setOpen(false); setShowNewDialog(true); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
            >
              <FilePlus size={13} className="shrink-0" />
              New file…
            </button>
            <button
              onClick={handleOpen}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
            >
              <FolderInput size={13} className="shrink-0" />
              Open file…
            </button>
          </div>
        )}
      </div>

      {showNewDialog && (
        <NewFileDialog
          onClose={() => setShowNewDialog(false)}
          onCreated={reload}
        />
      )}
    </>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

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

        {/* File switcher */}
        <div className="py-2 border-b border-sidebar-border">
          <div className="px-5 pb-1 pt-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">File</span>
          </div>
          <FileMenu />
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
