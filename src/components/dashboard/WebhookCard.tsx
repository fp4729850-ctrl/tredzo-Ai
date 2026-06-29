import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, Terminal, ExternalLink, Zap, Info } from 'lucide-react';

export function WebhookCard({ webhookToken }: { webhookToken?: string | null }) {
  const [copied, setCopied] = useState<'url' | 'payload' | 'complex' | null>(null);

  const webhookUrl = webhookToken
    ? `https://outklmllxsdrbifhvvcm.supabase.co/functions/v1/tradingview-webhook?token=${webhookToken}`
    : 'Generating token...';

  const payloadStr = `{
  "action": "{{strategy.order.action}}",
  "symbol": "{{ticker}}",
  "price": "{{close}}"
}`;

  const handleCopy = (text: string, type: 'url' | 'payload') => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!webhookToken) return null;

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-bold">
          <Terminal className="h-5 w-5 text-primary" />
          TradingView Webhooks
        </CardTitle>
        <CardDescription>
          Trigger trades instantly from your custom PineScript alerts.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Step 1 - Webhook URL */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">1. Webhook URL</span>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => handleCopy(webhookUrl, 'url')}>
              {copied === 'url' ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
              {copied === 'url' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <div className="rounded bg-muted p-2 font-mono text-xs text-muted-foreground break-all">
            {webhookUrl}
          </div>
        </div>

        {/* Step 2 - Alert JSON */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">2. Alert Message (JSON) — Sab Algos ke liye</span>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => handleCopy(payloadStr, 'payload')}>
              {copied === 'payload' ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
              {copied === 'payload' ? 'Copied!' : 'Copy'}
            </Button>
          </div>
          <pre className="rounded bg-muted p-2 font-mono text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
            {payloadStr}
          </pre>
          <p className="text-xs text-muted-foreground">
            ✅ Yeh JSON TradingView ke Alert Message box mein paste karein. Symbol aur Price automatically set ho jayega.
          </p>
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground pt-1 border-t border-border/50">
          <p className="flex items-center gap-1 font-semibold mb-2">
            <ExternalLink className="h-3 w-3" /> TradingView Setup Steps:
          </p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>TradingView kholen aur apni strategy ka ek naya <strong>Alert</strong> banayein.</li>
            <li><strong>Notifications</strong> tab mein jaayein aur <strong>Webhook URL</strong> checkbox tick karein.</li>
            <li>Step 1 ka URL wahan paste karein.</li>
            <li><strong>Settings</strong> tab mein jaayein, Message box saaf karein aur Step 2 ka JSON paste karein.</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}

