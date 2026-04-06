'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navItems = [
    { href: '/backoffice', label: 'Disputes' },
    { href: '/backoffice/customers', label: 'Customers' },
  ];

  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-[#004526] text-white p-6">
        <h2 className="text-lg font-bold mb-6 tracking-wide">Backoffice</h2>
        <nav className="flex flex-col gap-2">
          {navItems.map((item) => {
            const isActive =
              item.href === '/backoffice'
                ? pathname === '/backoffice'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 bg-[#F0F7F3]">{children}</main>
    </div>
  );
}
