import { SessionGate } from '@/components/session-gate';
import { WorkspaceShell } from '@/components/workspace-shell';
export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionGate>
      <WorkspaceShell appName={process.env.APP_NAME || 'JobPilot'}>
        {children}
      </WorkspaceShell>
    </SessionGate>
  );
}
