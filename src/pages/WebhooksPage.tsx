import React, { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layouts/AppLayout';
import { WebhookCard } from '@/components/dashboard/WebhookCard';
import { getUserSettings } from '@/services/api';

export function WebhooksPage() {
  const [webhookToken, setWebhookToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUserSettings().then((settings) => {
      if (settings) {
        setWebhookToken(settings.webhook_token || null);
      }
      setLoading(false);
    });
  }, []);

  return (
    <AppLayout>
      <div className="p-4 md:p-6 max-w-4xl space-y-5">
        <div>
          <h1 className="text-lg font-bold text-foreground">Webhooks Integration</h1>
          <p className="text-sm text-muted-foreground">Connect external signals to your bot</p>
        </div>
        
        {loading ? (
          <div className="animate-pulse h-64 bg-muted rounded-xl" />
        ) : (
          <WebhookCard webhookToken={webhookToken} />
        )}
      </div>
    </AppLayout>
  );
}
