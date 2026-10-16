'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Wordmark } from '@/components/wordmark';
import { apiFetch, type Role } from '@/lib/api';
import { useSession } from '@/lib/session';

const NAV: Array<{ href: string; label: string; roles: Role[] }> = [
  { href: '/dashboard', label: 'Painel', roles: ['ADMIN'] },
  { href: '/leads', label: 'Leads', roles: ['OPERATOR'] },
  { href: '/admin/dispatcher', label: 'Dispatcher', roles: ['ADMIN'] },
];

const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Administrador', OPERATOR: 'Operador' };

export default function AppLayout({ children }: { children: ReactNode }) {
  const { data: user, isPending, isError } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    queryClient.clear();
    router.replace('/login');
  }

  if (isPending || isError || !user) {
    // A 401 already redirected to /login inside apiFetch; this is only the brief wait.
    return (
      <p className="p-8 text-muted" aria-live="polite">
        Carregando…
      </p>
    );
  }

  const links = NAV.filter((item) => item.roles.includes(user.role));

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[208px_1fr]">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>

      <header className="flex flex-col border-rule md:sticky md:top-0 md:h-dvh md:border-r">
        <div className="flex items-center justify-between border-b border-rule px-5 py-4 md:block md:border-b-0 md:pt-6">
          <Wordmark compact />
        </div>

        <nav aria-label="Principal" className="border-b border-rule md:mt-6 md:border-b-0">
          <ul className="flex md:flex-col">
            {links.map((item) => {
              const current = pathname.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    className={`block border-b-2 px-5 py-2.5 md:border-b-0 md:border-l-2 ${
                      current
                        ? 'border-accent font-medium text-ink'
                        : 'border-transparent text-muted hover:text-ink'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden px-5 pb-6 md:mt-auto md:block">
          <p className="label">{ROLE_LABEL[user.role]}</p>
          <p className="mt-1 truncate text-[13px]" title={user.email}>
            {user.email}
          </p>
          <button type="button" onClick={logout} className="btn btn-quiet mt-3 -ml-3">
            Sair
          </button>
        </div>
      </header>

      <main id="conteudo" tabIndex={-1} className="min-w-0 px-5 py-6 md:px-10 md:py-8">
        {children}
        <div className="mt-12 flex items-center justify-between border-t border-rule pt-3 text-xs text-muted md:hidden">
          <span className="truncate">{user.email}</span>
          <button type="button" onClick={logout} className="btn btn-quiet">
            Sair
          </button>
        </div>
      </main>
    </div>
  );
}
