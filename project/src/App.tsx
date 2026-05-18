import { useState } from 'react';
import { AprendizesPage } from './features/aprendizes/AprendizesPage';
import { appBrand } from './shared/brand/appBrand';
import type { AppTab } from './shared/navigation/tabs';
import { appTabs } from './shared/navigation/tabs';
import { AppShell } from './shared/ui/AppShell';

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('aprendizes');

  return (
    <AppShell
      brand={appBrand}
      tabs={appTabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'aprendizes' && <AprendizesPage />}
    </AppShell>
  );
}
