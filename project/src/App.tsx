import { useEffect, useState } from 'react';
import { AprendizesPage } from './features/aprendizes/AprendizesPage';
import { appBrand } from './shared/brand/appBrand';
import type { AppTab } from './shared/navigation/tabs';
import { appTabs } from './shared/navigation/tabs';
import { AppShell } from './shared/ui/AppShell';
import { FeaturePlaceholderPage } from './shared/ui/FeaturePlaceholderPage';

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('aprendizes');
  const [isProviderReady, setIsProviderReady] = useState(false);

  useEffect(() => {
    let isActive = true;
    let heartbeat: number | undefined;

    const pingLocalProvider = () => {
      if (!isActive) {
        return;
      }

      void fetch('/api/app/heartbeat', {
        method: 'POST',
        cache: 'no-store',
      }).catch(() => {
        // The app renders only when the provider is present.
      });
    };
    const notifyLocalProviderClosed = () => {
      if (!isActive) {
        return;
      }

      isActive = false;

      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
      }

      if (!navigator.sendBeacon?.('/api/app/closed')) {
        void fetch('/api/app/closed', {
          method: 'POST',
          cache: 'no-store',
          keepalive: true,
        }).catch(() => {
          // Shutdown is best-effort from browser lifecycle events.
        });
      }
    };
    const startProviderSession = async () => {
      try {
        const response = await fetch('/api/app/status', {
          cache: 'no-store',
        });
        const status = response.ok ? await response.json() : null;

        if (!isActive || !status?.localProvider) {
          return;
        }

        setIsProviderReady(true);
        pingLocalProvider();
        heartbeat = window.setInterval(pingLocalProvider, 1000);
        window.addEventListener('pagehide', notifyLocalProviderClosed);
        window.addEventListener('beforeunload', notifyLocalProviderClosed);
      } catch {
        // Opened outside the executable/provider: render nothing.
      }
    };

    void startProviderSession();

    return () => {
      window.removeEventListener('pagehide', notifyLocalProviderClosed);
      window.removeEventListener('beforeunload', notifyLocalProviderClosed);
      notifyLocalProviderClosed();
    };
  }, []);

  if (!isProviderReady) {
    return null;
  }

  return (
    <AppShell
      brand={appBrand}
      tabs={appTabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      <div hidden={activeTab !== 'aprendizes'}>
        <AprendizesPage />
      </div>
      {activeTab !== 'aprendizes' && (
        <FeaturePlaceholderPage
          title={appTabs.find((tab) => tab.id === activeTab)?.label ?? ''}
        />
      )}
    </AppShell>
  );
}
