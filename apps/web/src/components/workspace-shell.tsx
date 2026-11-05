'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  BriefcaseBusiness,
  FileUser,
  Search,
  Kanban,
  Settings,
  LogOut,
  ArrowUpRight,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Brand } from './brand';
import { ThemeSwitch } from './theme-switch';
import { useSession, sessionKey } from '@/lib/session';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetClose,
} from '@/components/ui/sheet';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
const links = [
  { key: 'dashboard', href: '/dashboard', icon: LayoutDashboard },
  { key: 'offers', href: '/offres', icon: BriefcaseBusiness },
  { key: 'resumes', href: '/cv', icon: FileUser },
  { key: 'searches', href: '/recherches', icon: Search },
  { key: 'applications', href: '/candidatures', icon: Kanban },
  { key: 'settings', href: '/parametres', icon: Settings },
] as const;
export function WorkspaceShell({
  children,
  appName,
}: {
  children: React.ReactNode;
  appName: string;
}) {
  const nav = useTranslations('Nav');
  const t = useTranslations('Common');
  const d = useTranslations('Dashboard');
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => apiClient.logout(),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(sessionKey, null);
      router.replace('/connexion');
    },
    onError: () => toast.error(t('logoutError')),
  });
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');
  const active = links.find((v) => isActive(v.href));
  return (
    <SidebarProvider>
      <a href="#main-content" className="skip-link">
        {t('skip')}
      </a>
      <LocalizedSidebar>
        <SidebarHeader className="brand-header">
          <Brand name={appName} />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <p className="nav-section-title">{t('workspace')}</p>
            <nav aria-label={t('navigation')}>
              <SidebarMenu>
                {links.map((item) => (
                  <SidebarMenuItem key={item.key}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive(item.href)}
                      className="workspace-nav-link"
                    >
                      <WorkspaceLink
                        href={item.href}
                        aria-current={isActive(item.href) ? 'page' : undefined}
                      >
                        <item.icon aria-hidden="true" />
                        <span>{nav(item.key)}</span>
                      </WorkspaceLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroup>
          <div className="sidebar-note">
            <ArrowUpRight className="size-5" aria-hidden="true" />
            <p>{d('note')}</p>
            <span>{d('noteDescription')}</span>
          </div>
        </SidebarContent>
        <SidebarFooter className="workspace-account">
          <span className="account-avatar" aria-hidden="true">
            {session.data?.email.slice(0, 1).toUpperCase()}
          </span>
          <div className="account-copy">
            <strong>{t('workspace')}</strong>
            <span title={session.data?.email}>{session.data?.email}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('logout')}
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut className="size-4" aria-hidden="true" />
          </Button>
        </SidebarFooter>
      </LocalizedSidebar>
      <SidebarInset className="workspace-inset">
        <header className="workspace-header">
          <SidebarTrigger aria-label={t('menu')} />
          <span className="header-divider" />
          <span>{active ? nav(active.key) : nav('dashboard')}</span>
          <div className="header-right">
            <span className="private-label">
              <span />
              {t('workspace')}
            </span>
            <ThemeSwitch />
          </div>
        </header>
        <main id="main-content" className="workspace-main">
          {children}
        </main>
        <footer className="workspace-footer">
          <span>{appName}</span>
          <span>{t('appDescription')}</span>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  );
}

function WorkspaceLink(props: React.ComponentProps<typeof Link>) {
  const { setOpenMobile } = useSidebar();
  return <Link {...props} onClick={() => setOpenMobile(false)} />;
}
function LocalizedSidebar({ children }: { children: React.ReactNode }) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();
  const t = useTranslations('Common');
  if (!isMobile)
    return <Sidebar className="workspace-sidebar">{children}</Sidebar>;
  return (
    <Sheet open={openMobile} onOpenChange={setOpenMobile}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="workspace-mobile-sheet w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">{t('navigation')}</SheetTitle>
        <SheetClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-3 z-10"
            aria-label={t('closeMenu')}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </SheetClose>
        <Sidebar collapsible="none" className="workspace-sidebar w-full">
          {children}
        </Sidebar>
      </SheetContent>
    </Sheet>
  );
}
