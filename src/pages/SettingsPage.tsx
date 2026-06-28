import React, { useEffect, useState, useCallback } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye, EyeOff, Save, Loader2, Key, Shield, Bot, AlertTriangle, Flame, Bell, MessageCircle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { getUserSettings, upsertUserSettings, callBinanceTrade } from '@/services/api';
import type { UserSettings } from '@/types/types';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Partial<UserSettings>>({
    binance_api_key: '',
    binance_api_secret: '',
    bot_enabled: false,
    trading_mode: 'spot',
    use_testnet: true,
    min_confidence: 70,
    stop_loss_pct: 2.0,
    take_profit_pct: 4.0,
    position_size_pct: 5.0,
    max_open_trades: 5,
    telegram_bot_token: '',
    telegram_chat_id: '',
    whatsapp_enabled: false,
    whatsapp_phone: '',
    whatsapp_api_key: '',
    notifications_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [testingApi, setTestingApi] = useState(false);

  // Manual test trade state
  const [manualSymbol, setManualSymbol] = useState('DOGEUSDT');
  const [manualUsdt, setManualUsdt] = useState('10');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await getUserSettings();
    if (data) setSettings(data);
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await upsertUserSettings(settings);
    if (error) {
      toast.error(`Failed to save settings: ${error}`);
    } else {
      toast.success('Settings saved successfully!');
    }
    setSaving(false);
  };

  const handleTestApi = async () => {
    if (!settings.binance_api_key || !settings.binance_api_secret) {
      return toast.error('Enter API key and secret first');
    }
    setTestingApi(true);
    const { data, error } = await callBinanceTrade({ action: 'test-connection', testnet: settings.use_testnet });
    setTestingApi(false);
    if (error) {
      toast.error(`Connection failed: ${error}`);
    } else {
      const d = data as { mode?: string; accountType?: string };
      const configuredMode = settings.use_testnet ? 'testnet' : 'real';
      const configuredType = settings.trading_mode ?? 'spot';
      toast.success(
        `Connected! Mode: ${d.mode ?? configuredMode} | Trading: ${configuredType.toUpperCase()}`,
        { icon: '✅' }
      );
    }
  };

  const handleManualTrade = async (side: 'BUY' | 'SELL') => {
    if (!settings.binance_api_key || !settings.binance_api_secret) {
      return toast.error('Enter API key and secret first');
    }
    if (!manualSymbol) return toast.error('Symbol is required');
    const usdtAmount = parseFloat(manualUsdt);
    if (!usdtAmount || usdtAmount <= 0) return toast.error('USDT Amount must be greater than 0');

    setManualLoading(true);
    setManualResult(null);

    try {
      // Fetch current price to calculate quantity from USDT amount
      const base = settings.use_testnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
      const sym = manualSymbol.toUpperCase();

      // Fetch price + exchange info in parallel
      const [priceRes, infoRes] = await Promise.all([
        fetch(`${base}/api/v3/ticker/price?symbol=${sym}`),
        fetch(`${base}/api/v3/exchangeInfo?symbol=${sym}`),
      ]);
      const priceData = await priceRes.json();
      const infoData = await infoRes.json();

      const price = parseFloat(priceData.price);
      if (!price || price <= 0) throw new Error('Could not fetch price');

      // Get LOT_SIZE stepSize to determine correct decimal precision
      const filters = infoData?.symbols?.[0]?.filters ?? [];
      const lotFilter = filters.find((f: {filterType: string}) => f.filterType === 'LOT_SIZE');
      const stepSize: string = lotFilter?.stepSize ?? '1';
      const decimals = stepSize.includes('.') ? stepSize.split('.')[1].replace(/0+$/, '').length : 0;

      const rawQty = usdtAmount / price;
      const factor = Math.pow(10, decimals);
      const qty = Math.floor(rawQty * factor) / factor;

      if (qty <= 0) throw new Error(`Quantity too small. Try a larger USDT amount.`);

      const payload = {
        action: 'create-order' as const,
        testnet: settings.use_testnet ?? true,
        tradingMode: (settings.trading_mode ?? 'spot') as 'spot' | 'futures',
        symbol: sym,
        side,
        type: 'MARKET' as const,
        quantity: qty,
      };

      const { data, error } = await callBinanceTrade(payload);
      setManualLoading(false);
      if (error) {
        toast.error(`Order failed: ${error}`);
        setManualResult(`❌ Error: ${error}`);
      } else {
        toast.success(`${side} executed! ${usdtAmount} USDT → ${qty} ${sym.replace('USDT','')} @ $${price}`, { icon: '🚀' });
        setManualResult(JSON.stringify(data, null, 2));
      }
    } catch (e) {
      setManualLoading(false);
      toast.error(`Failed: ${(e as Error).message}`);
    }
  };

  const set = (key: keyof UserSettings, value: unknown) =>
    setSettings(prev => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <AppLayout>
        <div className="p-4 md:p-6 space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full bg-muted" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="p-4 md:p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-foreground text-balance">Settings</h1>
            <p className="text-sm text-muted-foreground">Configure your trading bot and API credentials</p>
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving} className="shrink-0 h-9 gap-2">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span className="sr-only md:not-sr-only">Save Changes</span>
          </Button>
        </div>

        {/* Binance API */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-balance">
              <Key className="h-4 w-4 text-primary" />
              Binance API Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {/* Testnet / Real Toggle */}
            <div className="flex items-center justify-between rounded border border-border bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Binance Mode</p>
                <p className="text-xs text-muted-foreground">
                  {settings.use_testnet ? 'Testnet — simulated trading with fake money' : 'REAL — live trading with real funds'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={cn('text-[10px]',
                    settings.use_testnet ? 'border-success/40 text-success' : 'border-destructive/40 text-destructive'
                  )}
                >
                  {settings.use_testnet ? 'TESTNET' : 'LIVE'}
                </Badge>
                <Switch
                  checked={settings.use_testnet ?? true}
                  onCheckedChange={v => set('use_testnet', v)}
                />
              </div>
            </div>

            {!settings.use_testnet && (
              <div className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2">
                <div className="flex items-start gap-2">
                  <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <strong className="text-destructive">REAL MODE ACTIVE</strong> — Trades will use 
                    <strong className="text-foreground"> real money</strong>. Double-check your API key permissions 
                    and risk settings before proceeding.
                  </p>
                </div>
              </div>
            )}

            <div className="rounded border border-warning/30 bg-warning/5 px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Use a Binance API key with <strong className="text-foreground">trading permissions only</strong>. 
                  Never enable withdrawal permissions. Your keys are stored securely and encrypted.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-normal">API Key</Label>
                <div className="relative">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder="Enter Binance API Key"
                    value={settings.binance_api_key ?? ''}
                    onChange={e => set('binance_api_key', e.target.value)}
                    className="bg-input border-border pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-normal">API Secret</Label>
                <div className="relative">
                  <Input
                    type={showSecret ? 'text' : 'password'}
                    placeholder="Enter Binance API Secret"
                    value={settings.binance_api_secret ?? ''}
                    onChange={e => set('binance_api_secret', e.target.value)}
                    className="bg-input border-border pr-10 font-mono text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret(!showSecret)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestApi}
                disabled={testingApi}
                className="h-9 gap-2 border-border"
              >
                {testingApi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                Test Connection
              </Button>
              <Select
                value={settings.trading_mode ?? 'spot'}
                onValueChange={v => set('trading_mode', v)}
              >
                <SelectTrigger className="h-9 w-36 border-border bg-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="spot">Spot Trading</SelectItem>
                  <SelectItem value="futures">Futures Trading</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Manual Test Trade */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-balance">
              <Flame className="h-4 w-4 text-warning animate-pulse" />
              🧪 Manual Test Trade (Real or Testnet)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Fire a manual trade to test your Binance API permissions directly.
                Uses the current mode (<strong className="text-foreground">{settings.use_testnet ? 'TESTNET' : 'REAL'}</strong>)
                and trading mode (<strong className="text-foreground">{(settings.trading_mode ?? 'spot').toUpperCase()}</strong>) selected above.
              </p>
            </div>

            <div className="grid gap-3 grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Symbol</Label>
                <Input
                  type="text"
                  placeholder="e.g. DOGEUSDT"
                  value={manualSymbol}
                  onChange={e => setManualSymbol(e.target.value)}
                  className="h-8 bg-input border-border font-mono text-xs uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount (USDT) 💵</Label>
                <Input
                  type="number"
                  placeholder="e.g. 10"
                  value={manualUsdt}
                  onChange={e => setManualUsdt(e.target.value)}
                  className="h-8 bg-input border-border font-mono text-xs"
                />
                <span className="text-[9px] text-muted-foreground">
                  Bot current price se qty auto-calculate karega
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                onClick={() => handleManualTrade('BUY')}
                disabled={manualLoading}
                className="flex-1 bg-success hover:bg-success/90 text-white h-8 text-xs font-semibold"
              >
                {manualLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                🟢 BUY / LONG
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleManualTrade('SELL')}
                disabled={manualLoading}
                className="flex-1 bg-destructive hover:bg-destructive/90 text-white h-8 text-xs font-semibold"
              >
                {manualLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                🔴 SELL / SHORT
              </Button>
            </div>

            {manualResult && (
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Execution Result</Label>
                <pre className="max-h-40 overflow-y-auto rounded bg-muted/80 p-2 font-mono text-[10px] text-foreground border border-border">
                  {manualResult}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bot Configuration */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-balance">
              <Bot className="h-4 w-4 text-primary" />
              Bot Configuration
              <Badge variant="outline" className="ml-auto text-[10px] border-primary/30 text-primary">Global Defaults</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                ये settings सभी strategies के लिए <strong className="text-foreground">default fallback</strong> हैं।
                किसी strategy का अपना SL/TP set करने के लिए
                <strong className="text-primary"> Strategy Manager → strategy select → Risk Settings</strong> जाएं।
              </p>
            </div>
            <div className="flex items-center justify-between rounded border border-border bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Automated Trading</p>
                <p className="text-xs text-muted-foreground">Enable bot to execute trades automatically</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge
                  variant="outline"
                  className={cn('text-[10px]',
                    settings.bot_enabled ? 'border-success/40 text-success' : 'border-border text-muted-foreground'
                  )}
                >
                  {settings.bot_enabled ? 'ACTIVE' : 'PAUSED'}
                </Badge>
                <Switch
                  checked={settings.bot_enabled ?? false}
                  onCheckedChange={v => set('bot_enabled', v)}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-normal">
                  Min Confidence Threshold
                  <span className="ml-1 text-xs text-muted-foreground">({settings.min_confidence}%)</span>
                </Label>
                <Input
                  type="number"
                  min={0} max={100}
                  value={settings.min_confidence ?? 70}
                  onChange={e => set('min_confidence', Number(e.target.value))}
                  className="bg-input border-border data-mono"
                />
                <p className="text-[10px] text-muted-foreground">Only execute signals above this confidence</p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-normal">Max Open Trades</Label>
                <Input
                  type="number"
                  min={1} max={50}
                  value={settings.max_open_trades ?? 5}
                  onChange={e => set('max_open_trades', Number(e.target.value))}
                  className="bg-input border-border data-mono"
                />
                <p className="text-[10px] text-muted-foreground">Maximum simultaneous open positions</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Notifications — Telegram + WhatsApp */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-balance">
              <Bell className="h-4 w-4 text-primary" />
              Notifications
              <Badge variant="outline" className="ml-auto text-[10px] border-primary/30 text-primary">Alerts</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {/* Master toggle */}
            <div className="flex items-center justify-between rounded border border-border bg-muted/20 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Enable Notifications</p>
                <p className="text-xs text-muted-foreground">Receive BUY/SELL alerts on every bot signal</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className={cn('text-[10px]',
                  settings.notifications_enabled ? 'border-success/40 text-success' : 'border-border text-muted-foreground'
                )}>
                  {settings.notifications_enabled ? 'ON' : 'OFF'}
                </Badge>
                <Switch
                  checked={settings.notifications_enabled ?? true}
                  onCheckedChange={v => set('notifications_enabled', v)}
                />
              </div>
            </div>

            {/* Telegram */}
            <div className="space-y-3 rounded border border-border bg-muted/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <Send className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm font-medium text-foreground">Telegram Bot</span>
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary ml-auto">Free</Badge>
              </div>
              <div className="rounded border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
                <p><strong className="text-foreground">Setup (3 steps):</strong></p>
                <p>1. Open Telegram → search <strong className="text-foreground">@BotFather</strong> → send <code className="bg-muted px-1 rounded">/newbot</code></p>
                <p>2. Copy the <strong className="text-foreground">Bot Token</strong> (looks like <code className="bg-muted px-1 rounded">123456:ABC-xyz...</code>)</p>
                <p>3. Message your bot once, then open <strong className="text-foreground">@userinfobot</strong> to get your <strong className="text-foreground">Chat ID</strong></p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">Bot Token</Label>
                  <Input
                    type="password"
                    placeholder="123456789:ABCdefGHI..."
                    value={settings.telegram_bot_token ?? ''}
                    onChange={e => set('telegram_bot_token', e.target.value)}
                    className="bg-input border-border font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">Chat ID</Label>
                  <Input
                    placeholder="e.g. 987654321"
                    value={settings.telegram_chat_id ?? ''}
                    onChange={e => set('telegram_chat_id', e.target.value)}
                    className="bg-input border-border font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            {/* WhatsApp */}
            <div className="space-y-3 rounded border border-border bg-muted/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-3.5 w-3.5 text-success" />
                <span className="text-sm font-medium text-foreground">WhatsApp Alerts</span>
                <Badge variant="outline" className="text-[10px] border-success/30 text-success ml-auto">via CallMeBot</Badge>
                <Switch
                  checked={settings.whatsapp_enabled ?? false}
                  onCheckedChange={v => set('whatsapp_enabled', v)}
                />
              </div>
              <div className="rounded border border-success/20 bg-success/5 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
                <p><strong className="text-foreground">Setup (free, 2 steps):</strong></p>
                <p>1. Add <strong className="text-foreground">+34 644 66 08 93</strong> to WhatsApp contacts</p>
                <p>2. Send this message to that number: <code className="bg-muted px-1 rounded">I allow callmebot to send me messages</code></p>
                <p>You'll receive your API key via WhatsApp within a minute.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">Your WhatsApp Phone Number</Label>
                  <Input
                    placeholder="+919876543210 (with country code)"
                    value={settings.whatsapp_phone ?? ''}
                    onChange={e => set('whatsapp_phone', e.target.value)}
                    disabled={!settings.whatsapp_enabled}
                    className="bg-input border-border font-mono text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">Include country code, e.g. +91 for India</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-normal">CallMeBot API Key</Label>
                  <Input
                    type="password"
                    placeholder="API key received via WhatsApp"
                    value={settings.whatsapp_api_key ?? ''}
                    onChange={e => set('whatsapp_api_key', e.target.value)}
                    disabled={!settings.whatsapp_enabled}
                    className="bg-input border-border font-mono text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">Sent to you by CallMeBot after setup</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Risk Management */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-3 pt-4 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold text-balance">
              <Shield className="h-4 w-4 text-primary" />
              Risk Management
              <Badge variant="outline" className="ml-auto text-[10px] border-muted-foreground/40 text-muted-foreground">Bot Default</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-[11px] text-muted-foreground mb-3">
              Per-strategy override: <strong className="text-foreground">Strategy Manager → Risk Settings</strong>
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-normal">
                  Stop Loss
                  <span className="ml-1 text-xs text-muted-foreground">({settings.stop_loss_pct}%)</span>
                </Label>
                <Input
                  type="number"
                  min={0.1} max={50} step={0.1}
                  value={settings.stop_loss_pct ?? 2}
                  onChange={e => set('stop_loss_pct', parseFloat(e.target.value))}
                  className="bg-input border-border data-mono"
                />
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive transition-all"
                    style={{ width: `${Math.min((settings.stop_loss_pct ?? 2) * 4, 100)}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-normal">
                  Take Profit
                  <span className="ml-1 text-xs text-muted-foreground">({settings.take_profit_pct}%)</span>
                </Label>
                <Input
                  type="number"
                  min={0.1} max={100} step={0.1}
                  value={settings.take_profit_pct ?? 4}
                  onChange={e => set('take_profit_pct', parseFloat(e.target.value))}
                  className="bg-input border-border data-mono"
                />
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{ width: `${Math.min((settings.take_profit_pct ?? 4) * 2, 100)}%` }}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-normal">
                  Position Size
                  <span className="ml-1 text-xs text-muted-foreground">({settings.position_size_pct}% of balance)</span>
                </Label>
                <Input
                  type="number"
                  min={0.1} max={100} step={0.1}
                  value={settings.position_size_pct ?? 5}
                  onChange={e => set('position_size_pct', parseFloat(e.target.value))}
                  className="bg-input border-border data-mono"
                />
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.min(settings.position_size_pct ?? 5, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Risk/Reward Ratio */}
            <div className="mt-4 rounded border border-border bg-muted/20 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs text-muted-foreground">
                  Risk/Reward Ratio
                </div>
                <div className={cn('text-sm font-bold data-mono',
                  (settings.take_profit_pct ?? 4) / (settings.stop_loss_pct ?? 2) >= 2
                    ? 'text-success' : 'text-warning'
                )}>
                  1:{((settings.take_profit_pct ?? 4) / (settings.stop_loss_pct ?? 2)).toFixed(1)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="h-10 gap-2 px-6">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save All Settings
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
