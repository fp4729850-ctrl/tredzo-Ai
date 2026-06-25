import React, { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ShieldCheck, RefreshCw, Search, Code2, Clock, User, TrendingUp, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { getAllStrategiesAdmin } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Strategy } from '@/types/types';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

type AdminStrategy = Strategy & { profile_email: string | null; profile_username: string | null };

export default function AdminPage() {
  const { profile, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [strategies, setStrategies] = useState<AdminStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Guard: redirect non-admins
  useEffect(() => {
    if (!authLoading && profile?.role !== 'admin') {
      navigate('/');
    }
  }, [profile, authLoading, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getAllStrategiesAdmin();
    setStrategies(data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    await load();
    toast.success('Admin panel refreshed', { icon: '🔄', duration: 2000 });
  };

  const filtered = strategies.filter(s => {
    const q = search.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.profile_email ?? '').toLowerCase().includes(q) ||
      (s.profile_username ?? '').toLowerCase().includes(q) ||
      (s.symbol ?? '').toLowerCase().includes(q)
    );
  });

  const stats = {
    total: strategies.length,
    active: strategies.filter(s => s.status === 'active').length,
    users: new Set(strategies.map(s => s.user_id)).size,
    withAI: strategies.filter(s => s.strategy_params != null).length,
  };

  const fmtDate = (ts: string | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  if (authLoading || profile?.role !== 'admin') {
    return (
      <AppLayout>
        <div className="p-4 md:p-6 space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 w-full bg-muted" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-bold text-foreground text-balance">Admin Panel</h1>
              <p className="text-xs text-muted-foreground">All user strategies — auto-updated on every save</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="h-9 gap-2 border-border shrink-0">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Total Strategies', value: stats.total, color: 'text-foreground' },
            { label: 'Active', value: stats.active, color: 'text-success' },
            { label: 'Users', value: stats.users, color: 'text-primary' },
            { label: 'AI Analyzed', value: stats.withAI, color: 'text-primary' },
          ].map(s => (
            <Card key={s.label} className="border-border bg-card">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={cn('text-2xl font-bold font-mono mt-1', s.color)}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by user, strategy name, symbol..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-9 bg-input border-border text-sm"
          />
        </div>

        {/* Strategies Table */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-balance">
              <Code2 className="h-4 w-4 text-primary" />
              User Strategies
              <Badge variant="outline" className="ml-auto text-[10px] border-primary/30 text-primary">
                {filtered.length} strategies
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {loading ? (
              <div className="space-y-2 p-4">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full bg-muted" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Code2 className="h-8 w-8 opacity-30" />
                <p className="text-sm">कोई strategy नहीं मिली</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border">
                      <TableHead className="whitespace-nowrap text-xs">User</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Strategy Name</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Symbol / TF</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Status</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Last Signal</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Saved At</TableHead>
                      <TableHead className="whitespace-nowrap text-xs">Code</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(s => (
                      <React.Fragment key={s.id}>
                        <TableRow className="border-border hover:bg-muted/30 cursor-pointer" onClick={() => setExpanded(expanded === s.id ? null : s.id)}>
                          {/* User */}
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                                {(s.profile_username ?? s.profile_email ?? 'U')[0].toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-foreground truncate max-w-[120px]">
                                  {s.profile_username ?? s.profile_email ?? 'Unknown'}
                                </p>
                                {s.profile_username && (
                                  <p className="text-[10px] text-muted-foreground truncate max-w-[120px]">{s.profile_email}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          {/* Strategy name */}
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium text-foreground">{s.name}</span>
                              {s.strategy_params && (
                                <Badge variant="outline" className="text-[9px] border-primary/30 text-primary py-0">AI</Badge>
                              )}
                            </div>
                            {s.description && (
                              <p className="text-[10px] text-muted-foreground truncate max-w-[160px]">{s.description}</p>
                            )}
                          </TableCell>
                          {/* Symbol / TF */}
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1 flex-wrap">
                              {(s.symbols ?? [s.symbol ?? s.strategy_params?.symbol ?? 'BTCUSDT']).map(sym => (
                                <Badge key={sym} variant="outline" className="text-[9px] border-primary/40 text-primary font-mono py-0">
                                  {sym.replace('USDT','')}
                                </Badge>
                              ))}
                              <Badge variant="outline" className="text-[9px] border-border font-mono py-0">
                                {s.timeframe ?? s.strategy_params?.timeframe ?? '1h'}
                              </Badge>
                            </div>
                          </TableCell>
                          {/* Status */}
                          <TableCell className="whitespace-nowrap">
                            <Badge variant="outline" className={cn('text-[10px]',
                              s.status === 'active' ? 'border-success/40 text-success' : 'border-border text-muted-foreground'
                            )}>
                              {s.status === 'active' ? '● ACTIVE' : '○ INACTIVE'}
                            </Badge>
                          </TableCell>
                          {/* Last signal */}
                          <TableCell className="whitespace-nowrap">
                            {s.last_signal ? (
                              <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-medium',
                                s.last_signal === 'BUY' ? 'text-success' :
                                s.last_signal === 'SELL' ? 'text-destructive' : 'text-muted-foreground'
                              )}>
                                {s.last_signal === 'BUY' && <TrendingUp className="h-3 w-3" />}
                                {s.last_signal === 'SELL' && <TrendingDown className="h-3 w-3" />}
                                {s.last_signal}
                              </span>
                            ) : <span className="text-[10px] text-muted-foreground">—</span>}
                          </TableCell>
                          {/* Saved at */}
                          <TableCell className="whitespace-nowrap">
                            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Clock className="h-3 w-3 shrink-0" />
                              {fmtDate(s.created_at)}
                            </span>
                          </TableCell>
                          {/* Code toggle */}
                          <TableCell className="whitespace-nowrap">
                            <Button variant="ghost" size="sm" onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="h-6 px-2 text-[10px] text-primary">
                              {expanded === s.id ? 'Hide' : 'View'}
                            </Button>
                          </TableCell>
                        </TableRow>
                        {/* Expanded PineScript code */}
                        {expanded === s.id && (
                          <TableRow className="border-border bg-muted/10">
                            <TableCell colSpan={7} className="p-0">
                              <div className="px-4 py-3 space-y-1.5">
                                <div className="flex items-center gap-1.5">
                                  <User className="h-3 w-3 text-muted-foreground" />
                                  <span className="text-[10px] text-muted-foreground">
                                    {s.profile_email} · Saved: {fmtDate(s.created_at)}
                                    {s.last_executed_at && ` · Last run: ${fmtDate(s.last_executed_at)}`}
                                  </span>
                                </div>
                                {s.ai_interpretation && (
                                  <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground leading-relaxed">
                                    <strong className="text-primary">AI Analysis: </strong>
                                    {s.ai_interpretation.slice(0, 300)}{s.ai_interpretation.length > 300 ? '...' : ''}
                                  </div>
                                )}
                                <pre className="rounded border border-border bg-muted/30 p-3 text-[10px] font-mono text-foreground overflow-x-auto max-h-48 whitespace-pre-wrap break-words leading-relaxed">
                                  {s.pinescript_code}
                                </pre>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
