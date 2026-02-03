'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Database,
  Settings,
  Home,
  ChevronRight,
  Users,
  KeyRound,
  LogOut,
  BarChart3,
  ExternalLink,
  BookOpen,
  Eye,
  Clock,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth';
import { useDemo } from '@/lib/demo-context';
import { mockDemoUser } from '@/lib/demo-data';
import { Button } from '@/components/ui/button';

const navigation = [
  { name: 'Home', href: '/', icon: Home },
  { name: 'Projects', href: '/projects', icon: Database },
  { name: 'Docs', href: '/docs', icon: BookOpen },
  { name: 'Settings', href: '/settings', icon: Settings },
];

const adminNavigation = [
  { name: 'All Projects', href: '/admin/projects', icon: BarChart3 },
  { name: 'Users', href: '/admin/users', icon: Users },
  { name: 'Invites', href: '/admin/invites', icon: KeyRound },
];

const toolsNavigation = [
  { name: 'Cron Jobs', href: '/admin/cron', icon: Clock },
  { name: 'Backups', href: '/admin/backups', icon: Archive },
  // Note: Data Tools (Import/Export) is now per-project at Projects > [id] > Data Tools
];

const externalLinks = [
  { name: 'View Demo', href: '/?demo=true', icon: Eye },
  { name: 'Landing Page', href: '/landing', icon: ExternalLink },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAdmin, logout } = useAuth();
  const { isDemo, exitDemo } = useDemo();

  // Use mock user in demo mode
  const displayUser = isDemo ? mockDemoUser : user;
  const showAdmin = isDemo || isAdmin;

  const handleLogout = async () => {
    if (isDemo) {
      // In demo mode, use full page navigation to avoid router issues
      exitDemo();
      return;
    }
    await logout();
    router.push('/login');
  };

  return (
    <aside className="flex flex-col w-64 min-h-screen border-r border-zinc-800 bg-zinc-900">
      <div className="p-4 border-b border-zinc-800">
        <Link href={isDemo ? '/?demo=true' : '/'} className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <Database className="h-5 w-5 text-emerald-500" />
          </div>
          <span className="font-semibold text-lg text-zinc-100">AtlasHub</span>
        </Link>
      </div>

      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {navigation.map((item) => {
            const href = isDemo ? `${item.href}?demo=true` : item.href;
            const isActive =
              pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <li key={item.name}>
                <Link
                  href={href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.name}
                  {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                </Link>
              </li>
            );
          })}
        </ul>

        {showAdmin && (
          <>
            <div className="my-4 border-t border-zinc-800" />
            <p className="px-3 mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Admin
            </p>
            <ul className="space-y-1">
              {adminNavigation.map((item) => {
                const href = isDemo ? `${item.href}?demo=true` : item.href;
                const isActive = pathname.startsWith(item.href);

                return (
                  <li key={item.name}>
                    <Link
                      href={href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.name}
                      {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="my-4 border-t border-zinc-800" />
            <p className="px-3 mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Tools
            </p>
            <ul className="space-y-1">
              {toolsNavigation.map((item) => {
                const href = isDemo ? `${item.href}?demo=true` : item.href;
                const isActive = pathname.startsWith(item.href);

                return (
                  <li key={item.name}>
                    <Link
                      href={href}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.name}
                      {isActive && <ChevronRight className="h-4 w-4 ml-auto" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {/* External Links - only show in non-demo mode */}
        {!isDemo && (
          <>
            <div className="my-4 border-t border-zinc-800" />
            <p className="px-3 mb-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Quick Links
            </p>
            <ul className="space-y-1">
              {externalLinks.map((item) => (
                <li key={item.name}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.name}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </nav>

      <div className="p-4 border-t border-zinc-800">
        {displayUser && (
          <div className="mb-3">
            <p className="text-sm font-medium text-zinc-200 truncate">{displayUser.email}</p>
            <p className="text-xs text-zinc-500 capitalize">{displayUser.role}</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={handleLogout}
          className="w-full justify-start text-zinc-400 hover:text-red-400 hover:bg-red-500/10"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {isDemo ? 'Exit Demo' : 'Sign out'}
        </Button>
        <p className="mt-3 text-xs text-zinc-600">AtlasHub v0.1.0</p>
      </div>
    </aside>
  );
}
