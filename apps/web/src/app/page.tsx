'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { homeFor, useSession } from '@/lib/session';

// "/" only decides where each role starts.
export default function HomePage() {
  const { data: user } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace(homeFor(user.role));
    }
  }, [user, router]);

  return (
    <p className="p-8 text-muted" aria-live="polite">
      Carregando…
    </p>
  );
}
