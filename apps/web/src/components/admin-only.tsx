'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { homeFor, useSession } from '@/lib/session';

// UX only: the API answers 403 to non-admins anyway. This replaces a generic error with a
// clear message and a way back.
export function AdminOnly({ children }: { children: ReactNode }) {
  const { data: user } = useSession();
  if (!user) return null;
  if (user.role === 'ADMIN') return <>{children}</>;
  return (
    <div className="max-w-[52ch] border-l-2 border-accent py-1 pl-4">
      <h1 className="text-lg font-semibold">Área restrita a administradores</h1>
      <p className="mt-1 text-muted">Sua conta é de operador; esta página não está disponível.</p>
      <Link href={homeFor(user.role)} className="mt-3 inline-block underline underline-offset-4">
        Voltar aos seus leads
      </Link>
    </div>
  );
}
