import { useEffect, useState } from 'react';
import { AprendizesPage } from './features/aprendizes/AprendizesPage';
import { ArcosPage } from './features/arcos/ArcosPage';
import { TurmasPage } from './features/turmas/TurmasPage';
import { appBrand } from './shared/brand/appBrand';
import type { AppTab } from './shared/navigation/tabs';
import { appTabs } from './shared/navigation/tabs';
import { ActionLogOverlay } from './shared/actionLog/ActionLogOverlay';
import { resetActionHistory } from './shared/actionLog/actionLog';
import { AppShell } from './shared/ui/AppShell';
import { FeaturePlaceholderPage } from './shared/ui/FeaturePlaceholderPage';
import {
  configureGlobalUndoNavigation,
  flushActiveGlobalUndoController,
  handleGlobalUndoShortcut,
  resetGlobalUndoHistory,
} from './shared/undo/globalUndo';

const isLocalAppAddress = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    window.location.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
  );
};

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('aprendizes');
  const [isProviderReady, setIsProviderReady] = useState(isLocalAppAddress);
  const [isInitialPageReady, setIsInitialPageReady] = useState(false);

  const changeActiveTab = (tab: AppTab) => {
    if (tab === activeTab) {
      return;
    }

    void (async () => {
      await flushActiveGlobalUndoController();
      setActiveTab(tab);
    })();
  };

  useEffect(() => {
    let isActive = true;
    let didConnectProvider = false;
    let heartbeat: number | undefined;
    let statusRetry: number | undefined;

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
    const scheduleProviderRetry = () => {
      if (!isActive) {
        return;
      }

      if (statusRetry !== undefined) {
        window.clearTimeout(statusRetry);
      }

      statusRetry = window.setTimeout(() => {
        statusRetry = undefined;
        void startProviderSession();
      }, 250);
    };
    const notifyLocalProviderClosed = () => {
      if (!isActive) {
        return;
      }

      isActive = false;

      if (statusRetry !== undefined) {
        window.clearTimeout(statusRetry);
      }

      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
      }

      if (!didConnectProvider) {
        return;
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
          scheduleProviderRetry();
          return;
        }

        didConnectProvider = true;
        setIsProviderReady(true);
        pingLocalProvider();
        if (heartbeat === undefined) {
          heartbeat = window.setInterval(pingLocalProvider, 1000);
        }
        window.addEventListener('pagehide', notifyLocalProviderClosed);
        window.addEventListener('beforeunload', notifyLocalProviderClosed);
      } catch {
        scheduleProviderRetry();
      }
    };

    void startProviderSession();

    return () => {
      window.removeEventListener('pagehide', notifyLocalProviderClosed);
      window.removeEventListener('beforeunload', notifyLocalProviderClosed);

      isActive = false;

      if (statusRetry !== undefined) {
        window.clearTimeout(statusRetry);
      }

      if (heartbeat !== undefined) {
        window.clearInterval(heartbeat);
      }
    };
  }, []);

  useEffect(() => {
    if (!isProviderReady) {
      return;
    }

    let isActive = true;

    const consumeFreshDevReset = async () => {
      try {
        const response = await fetch('/api/dev/freshdev-reset', {
          cache: 'no-store',
        });
        const result = response.ok
          ? ((await response.json()) as { reset?: boolean })
          : null;

        if (!isActive || !result?.reset) {
          return;
        }

        resetGlobalUndoHistory();
        resetActionHistory();
      } catch {
        // The endpoint exists only in the local provider; normal app startup continues.
      }
    };

    void consumeFreshDevReset();

    return () => {
      isActive = false;
    };
  }, [isProviderReady]);

  useEffect(() => {
    if (!isProviderReady || !isInitialPageReady) {
      return;
    }

    let isActive = true;
    let frameId = 0;

    frameId = window.requestAnimationFrame(() => {
      if (!isActive) {
        return;
      }

      void fetch('/api/app/ready', {
        method: 'POST',
        cache: 'no-store',
      }).catch(() => {
        // Browser preview can run without the local launcher reveal bridge.
      });
    });

    return () => {
      isActive = false;
      window.cancelAnimationFrame(frameId);
    };
  }, [isInitialPageReady, isProviderReady]);

  useEffect(() => {
    configureGlobalUndoNavigation(
      () => activeTab,
      (tab) =>
        new Promise<void>((resolve) => {
          setActiveTab(tab);
          window.requestAnimationFrame(() => resolve());
        }),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      handleGlobalUndoShortcut(event);
    };

    window.addEventListener('keydown', handleKeyDown, {
      capture: true,
    });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, {
        capture: true,
      });
    };
  }, [activeTab]);

  if (!isProviderReady) {
    return null;
  }

  return (
    <AppShell
      brand={appBrand}
      tabs={appTabs}
      activeTab={activeTab}
      onTabChange={changeActiveTab}
    >
      <ActionLogOverlay />
      <div hidden={activeTab !== 'aprendizes'}>
        <AprendizesPage
          isActive={activeTab === 'aprendizes'}
          onInitialReady={() => setIsInitialPageReady(true)}
        />
      </div>
      <div hidden={activeTab !== 'turmas'}>
        <TurmasPage
          canInitialize={isInitialPageReady || activeTab === 'turmas'}
          isActive={activeTab === 'turmas'}
        />
      </div>
      <div hidden={activeTab !== 'arcos'}>
        <ArcosPage
          canInitialize={isInitialPageReady || activeTab === 'arcos'}
          isActive={activeTab === 'arcos'}
        />
      </div>
      {activeTab !== 'aprendizes' &&
        activeTab !== 'turmas' &&
        activeTab !== 'arcos' && (
        <FeaturePlaceholderPage
          title={appTabs.find((tab) => tab.id === activeTab)?.label ?? ''}
        />
        )}
    </AppShell>
  );
}
