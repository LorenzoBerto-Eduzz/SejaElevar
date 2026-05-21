import { useEffect, useState } from 'react';
import { AprendizesPage } from './features/aprendizes/AprendizesPage';
import { appBrand } from './shared/brand/appBrand';
import type { AppTab } from './shared/navigation/tabs';
import { appTabs } from './shared/navigation/tabs';
import { AppShell } from './shared/ui/AppShell';
import { FeaturePlaceholderPage } from './shared/ui/FeaturePlaceholderPage';

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('aprendizes');

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
        // Normal if the HTML is opened without the local app provider.
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
          // Normal if the HTML is opened without the local app provider.
        });
      }
    };

    pingLocalProvider();
    heartbeat = window.setInterval(pingLocalProvider, 5000);
    window.addEventListener('pagehide', notifyLocalProviderClosed);

    return () => {
      window.removeEventListener('pagehide', notifyLocalProviderClosed);
      notifyLocalProviderClosed();
    };
  }, []);

  return (
    <AppShell
      brand={appBrand}
      tabs={appTabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'aprendizes' && <AprendizesPage />}
      {activeTab !== 'aprendizes' && (
        <FeaturePlaceholderPage
          title={appTabs.find((tab) => tab.id === activeTab)?.label ?? ''}
        />
      )}
    </AppShell>
  );
}
