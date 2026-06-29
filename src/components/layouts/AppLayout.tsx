import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ScanLine, Code2, Settings, History,
  Bot, LogOut, Menu, ChevronRight, Zap, FlaskConical, ShieldCheck
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { path: '/webhooks', icon: Zap, label: 'TV Webhooks' },
  { path: '/market', icon: ScanLine, label: 'Market Scan' },
  { path: '/strategies', icon: Code2, label: 'Strategies' },
  { path: '/backtest', icon: FlaskConical, label: 'Backtesting' },
  { path: '/history', icon: History, label: 'Trade History' },
  { path: '/settings', icon: Settings, label: 'Settings' },
];

interface SidebarNavProps {
  onClose?: () => void;
}

const SidebarNav: React.FC<SidebarNavProps> = ({ onClose }) => {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-full flex-col bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-primary">
          <Bot className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">Tredzo AI</p>
          <p className="text-xs text-muted-foreground">Tredzo AI Platform</p>
        </div>
      </div>

      {/* Bot Status */}
      <div className="mx-3 my-3 flex items-center gap-2 rounded border border-border bg-muted/30 px-3 py-2">
        <div className="h-2 w-2 rounded-full bg-success scan-pulse" />
        <span className="text-xs text-muted-foreground">Scanner Active</span>
        <Badge variant="outline" className="ml-auto text-[10px] border-primary/40 text-primary">
          LIVE
        </Badge>
      </div>

      {/* Nav Items */}
      <nav className="flex-1 space-y-0.5 px-2 py-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'group flex min-h-10 items-center gap-3 rounded px-3 py-2 text-sm transition-colors duration-150',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                <span className="flex-1 truncate">{item.label}</span>
                {isActive && <ChevronRight className="h-3 w-3 shrink-0 text-primary" />}
              </>
            )}
          </NavLink>
        ))}
        {/* Admin-only link */}
        {profile?.role === 'admin' && (
          <NavLink
            to="/admin"
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                'group flex min-h-10 items-center gap-3 rounded px-3 py-2 text-sm transition-colors duration-150',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )
            }
          >
            {({ isActive }) => (
              <>
                <ShieldCheck className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-warning')} />
                <span className="flex-1 truncate">Admin Panel</span>
                {isActive
                  ? <ChevronRight className="h-3 w-3 shrink-0 text-primary" />
                  : <Badge variant="outline" className="text-[9px] border-warning/40 text-warning py-0 px-1">ADMIN</Badge>
                }
              </>
            )}
          </NavLink>
        )}
      </nav>

      {/* User Info + Sign Out */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <div className="mb-2 flex items-center gap-2 px-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
            {(profile?.username ?? profile?.email ?? 'U')[0].toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-sidebar-accent-foreground">
              {profile?.username ?? profile?.email ?? 'User'}
            </p>
            <p className="text-[10px] text-muted-foreground capitalize">{profile?.role ?? 'user'}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>
    </div>
  );
};

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen w-full bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden w-56 shrink-0 border-r border-border lg:flex lg:flex-col">
        <SidebarNav />
      </aside>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-56 p-0 bg-sidebar border-border">
          <SidebarNav onClose={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        {/* Mobile Header */}
        <header className="flex h-12 items-center gap-3 border-b border-border bg-card px-4 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            <Zap className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-sm font-semibold">Tredzo AI</span>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
};
