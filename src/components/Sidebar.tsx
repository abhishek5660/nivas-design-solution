'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from './Logo';

const NAV: { href: string; label: string; icon: string; group: string; admin?: boolean }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10', group: 'Workspace' },
  { href: '/projects', label: 'My Projects', icon: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z', group: 'Workspace' },
  { href: '/designer/wardrobe', label: 'Wardrobe Designer', icon: 'M5 3h14v18H5zM12 3v18M9 11v2M15 11v2', group: 'Designers' },
  { href: '/designer/kitchen', label: 'Kitchen Designer', icon: 'M3 20V9h18v11M3 9V4h18v5M8 14h3M14 14h3', group: 'Designers' },
  { href: '/designer/tv-panel', label: 'TV Panel Designer', icon: 'M3 5h18v11H3zM8 21h8M12 16v5', group: 'Designers' },
  { href: '/designer/custom', label: 'Custom Furniture', icon: 'M4 10h16v4H4zM6 14v6M18 14v6M7 10V6h10v4', group: 'Designers' },
  { href: '/library', label: '3D Component Library', icon: 'M12 3l9 5v8l-9 5-9-5V8zM12 12l9-5M12 12v9M12 12L3 7', group: 'Library' },
  { href: '/materials', label: 'Materials & Hardware', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', group: 'Library' },
  { href: '/templates', label: 'Templates', icon: 'M5 3h10l4 4v14H5zM14 3v5h5', group: 'Library' },
  { href: '/drawings', label: '2D Drawings', icon: 'M3 21L21 3M3 3h6M3 3v6M21 21h-6M21 21v-6', group: 'Documents' },
  { href: '/boq', label: 'BOQ & Quotations', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', group: 'Documents' },
  { href: '/production', label: 'Production Documents', icon: 'M4 20h16M6 20V10l6-4 6 4v10M10 20v-6h4v6', group: 'Documents' },
  { href: '/admin', label: 'Administration', icon: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', group: 'System', admin: true },
  { href: '/settings', label: 'Settings', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM4 12h2M18 12h2M12 4v2M12 18v2', group: 'System' },
];

export function Sidebar({ user }: { user: { name: string; email: string; role: string } }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-sand bg-paper px-4 py-3 lg:hidden">
        <Logo />
        <button className="btn btn-sm" aria-expanded={open} aria-label="Toggle navigation" onClick={() => setOpen((o) => !o)}>
          Menu
        </button>
      </div>
      <aside className={`${open ? 'block' : 'hidden'} w-full shrink-0 flex-col border-r border-sand bg-ink text-ivory lg:flex lg:w-64`}>
        <div className="hidden px-5 py-5 lg:block"><Logo light /></div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-1 lg:pt-2" aria-label="Main">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-mute">{g}</div>
              {NAV.filter((n) => n.group === g && (!n.admin || user.role === 'ADMIN')).map((n) => {
                const active = path === n.href || (n.href !== '/dashboard' && path.startsWith(n.href));
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] transition-colors ${active ? 'bg-white/10 text-white' : 'text-stone hover:bg-white/5 hover:text-white'}`}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={active ? '#e7d4a6' : 'currentColor'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d={n.icon} />
                    </svg>
                    {n.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-1.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-gold/90 text-sm font-bold text-ink">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{user.name}</div>
              <div className="truncate text-[11px] text-mute">{user.role.toLowerCase()}</div>
            </div>
            <button className="rounded p-1.5 text-stone hover:bg-white/10 hover:text-white" onClick={logout} aria-label="Sign out" title="Sign out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9" /></svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
