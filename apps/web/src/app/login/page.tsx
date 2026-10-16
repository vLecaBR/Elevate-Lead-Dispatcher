'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, Suspense, useState } from 'react';
import { Wordmark } from '@/components/wordmark';
import { ApiError, apiFetch, type SessionUser } from '@/lib/api';
import { homeFor } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const { user } = await apiFetch<{ user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      queryClient.setQueryData(['me'], user);
      // Only same-site paths are followed (no open redirect through ?next=).
      const next = params.get('next');
      router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : homeFor(user.role));
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 429
          ? 'Muitas tentativas. Aguarde um minuto e tente de novo.'
          : 'E-mail ou senha inválidos.',
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-10 max-w-[360px] space-y-5">
      <div>
        <label htmlFor="email" className="label mb-1.5 block">
          E-mail
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="field"
        />
      </div>
      <div>
        <label htmlFor="password" className="label mb-1.5 block">
          Senha
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field"
        />
      </div>

      {error && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-danger">
          {error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}

// How a lead travels, in three lines: useful context for a new operator, set like the
// sidebar of a printed page rather than a marketing panel.
const FLOW = [
  ['01', 'Recebimento', 'As landing pages enviam o lead; duplicatas são reconhecidas.'],
  ['02', 'Distribuição', 'Cada lead vai para um call center conforme o peso configurado.'],
  ['03', 'Acompanhamento', 'Os call centers atualizam o status; o histórico fica completo.'],
] as const;

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[1080px] flex-col px-6 md:px-10">
      <header className="flex items-center justify-between border-b border-ink py-4">
        <Wordmark />
        <span className="label">Acesso restrito</span>
      </header>

      <div className="grid flex-1 gap-12 py-12 md:grid-cols-12 md:py-20">
        <main className="md:col-span-5">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Entrar</h1>
          <p className="mt-2 max-w-[34ch] text-muted">
            Administradores veem todos os leads; operadores, os do próprio call center.
          </p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </main>

        <aside aria-label="Como funciona" className="md:col-span-6 md:col-start-7 md:pt-2">
          <p className="label">Como um lead chega até você</p>
          <ol className="mt-3 border-t border-rule">
            {FLOW.map(([step, title, text]) => (
              <li
                key={step}
                className="grid grid-cols-[2.5rem_1fr] gap-x-3 border-b border-rule py-4"
              >
                <span className="num text-muted">{step}</span>
                <span>
                  <span className="font-medium">{title}</span>
                  <span className="mt-0.5 block text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-rule py-3 text-xs text-muted">
        <span>
          Sessões expiram em 8 horas. Cinco tentativas erradas bloqueiam a conta por 15 minutos.
        </span>
        <span className="num">Elevate · 2026</span>
      </footer>
    </div>
  );
}
