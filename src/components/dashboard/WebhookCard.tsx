import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check, Terminal, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export function WebhookCard({ webhookToken }: { webhookToken?: string | null }) {
  const [copied, setCopied] = useState<'url' | 'payload' | null>(null);

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
      <CardContent className="space-y-4">
        
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">1. Webhook URL</span>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => handleCopy(webhookUrl, 'url')}>
              {copied === 'url' ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied === 'url' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <div className="rounded bg-muted p-2 font-mono text-xs text-muted-foreground break-all">
            {webhookUrl}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">2. Alert Message (JSON)</span>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs" onClick={() => handleCopy(payloadStr, 'payload')}>
              {copied === 'payload' ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied === 'payload' ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="rounded bg-muted p-2 font-mono text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">
            {payloadStr}
          </pre>
        </div>

        <div className="text-xs text-muted-foreground pt-2 border-t border-border/50">
          <p className="flex items-center gap-1 font-semibold mb-1">
            <ExternalLink className="h-3 w-3" /> Setup Instructions:
          </p>
          <ul className="list-disc pl-4 space-y-1">
            <li>Open TradingView and create a new Alert.</li>
            <li>Go to the <strong>Notifications</strong> tab and check <strong>Webhook URL</strong>.</li>
            <li>Paste the Webhook URL (Step 1) into the box.</li>
            <li>Go to the <strong>Settings</strong> tab, clear the Message box, and paste the JSON (Step 2).</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
