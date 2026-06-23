import { useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useSettingsStore } from '@/stores/settingsStore';

const FONT_FAMILIES = ['Inter', 'JetBrains Mono', 'Fira Code', 'Source Sans Pro', 'IBM Plex Sans'];
const THEMES = ['Dark', 'Light', 'System'];
const DENSITIES = ['Compact', 'Comfortable', 'Spacious'];

export function AppearanceSettings() {
  const { appearance, fetchSettings, updateAppearance } = useSettingsStore();

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-2xl border border-border/60 bg-card/40 px-4 py-4 shadow-sm backdrop-blur-sm">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground/75">Visual</p>
        <h2 className="mt-1 text-lg font-semibold">Aparência</h2>
        <p className="text-sm text-muted-foreground/75">Personalize a aparência da interface.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Theme controls</CardTitle>
          <CardDescription>Ajustes de tipografia e densidade para melhorar leitura.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Font Size ({appearance.fontSize}px)</Label>
            <Slider
              value={[appearance.fontSize]}
              min={12}
              max={20}
              step={1}
              onValueChange={([v]: number[]) => updateAppearance({ fontSize: v })}
              className="mt-2"
            />
          </div>
          <div>
            <Label>Font Family</Label>
            <Select value={appearance.fontFamily} onValueChange={v => updateAppearance({ fontFamily: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FONT_FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Theme</Label>
            <Select value={appearance.theme} onValueChange={v => updateAppearance({ theme: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {THEMES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Density</Label>
            <Select value={appearance.density} onValueChange={v => updateAppearance({ density: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {DENSITIES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
