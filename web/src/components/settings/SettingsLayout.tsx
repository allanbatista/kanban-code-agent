import { useSearchParams } from 'react-router-dom';
import { PageContainer } from '@/components/layout/PageContainer';
import { SettingsSidebar } from '@/components/layout/SettingsSidebar';
import { AppearanceSettings } from './AppearanceSettings';
import { ProvidersSettings } from './ProvidersSettings';
import { AdvancedSettings } from './AdvancedSettings';
import type { SettingsSection } from '@/types/settings';

export function SettingsLayout() {
  const [searchParams, setSearchParams] = useSearchParams();
  const section = (searchParams.get('section') as SettingsSection) ?? 'appearance';

  const handleSectionChange = (s: SettingsSection) => {
    const params = new URLSearchParams(searchParams);
    params.set('section', s);
    setSearchParams(params, { replace: true });
  };

  return (
    <PageContainer>
      <div className="flex h-[calc(100vh-3.5rem)] min-h-0 overflow-hidden">
        <SettingsSidebar active={section} onChange={handleSectionChange} />
        <div className="flex-1 overflow-y-auto p-6">
          {section === 'appearance' && <AppearanceSettings />}
          {section === 'providers' && <ProvidersSettings />}
          {section === 'advanced' && <AdvancedSettings />}
        </div>
      </div>
    </PageContainer>
  );
}
