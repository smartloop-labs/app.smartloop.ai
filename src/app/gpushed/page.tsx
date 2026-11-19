'use client';

import { useAuth } from '@/app/hooks/useAuth';
import SettingsShell from '@/app/settings/settings-shell';
import GpushedSection from '@/app/gpushed/gpushed-section';

// GPU boxes (gpushed), open to every signed-in account.
export default function GpushedPage() {
  const [user] = useAuth();
  return (
    <SettingsShell user={user}>
      <GpushedSection user={user} />
    </SettingsShell>
  );
}
