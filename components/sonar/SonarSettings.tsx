'use client';

import type { ReactNode } from 'react';

import { ChevronDown, RotateCcw } from 'lucide-react';

import type { FftSize, NumericSettingKey, SonarSettings as Settings } from '@/lib/types';
import { FFT_SIZES, SETTING_SLIDERS } from '@/lib/sonar/constants';
import {
  Button,
  Card,
  CardContent,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import { Text } from '@/components/Text';

interface SonarSettingsProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReset: () => void;
}

function withNumber(settings: Settings, key: NumericSettingKey, value: number): Settings {
  const next = { ...settings };
  next[key] = value;
  return next;
}

function formatValue(value: number, scale: number, step: number): string {
  const shown = value * scale;
  const decimals = step * scale < 1 ? 1 : 0;
  return shown.toFixed(decimals);
}

const FFT_ITEMS = FFT_SIZES.map((size) => ({ value: String(size), label: String(size) }));

function SettingRow({
  id,
  label,
  value,
  children,
}: {
  id: string;
  label: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-baseline justify-between gap-2'>
        <Label htmlFor={id}>{label}</Label>
        {value !== undefined && (
          <Text as='span' variant='muted' size='xs' className='font-mono tabular-nums'>
            {value}
          </Text>
        )}
      </div>
      {children}
    </div>
  );
}

/** Every tuning knob, applied live and saved to localStorage. */
export function SonarSettings({ settings, onChange, onReset }: SonarSettingsProps) {
  return (
    <Collapsible>
      <Card>
        <CardContent className='flex flex-col gap-4'>
          <div className='flex items-center justify-between gap-2'>
            <CollapsibleTrigger
              render={<Button variant='ghost' className='group -ml-2 justify-start' />}
            >
              <ChevronDown
                className='transition-transform group-data-panel-open:rotate-180'
              />
              <Text variant='hd-xs' as='span'>
                Settings
              </Text>
            </CollapsibleTrigger>
            <Button variant='ghost' size='sm' onClick={onReset}>
              <RotateCcw /> Reset
            </Button>
          </div>
          <CollapsibleContent className='flex flex-col gap-6'>
            <div className='grid gap-6 sm:grid-cols-2'>
              <SettingRow id='sonar-mode' label='Detection mode'>
                <Tabs
                  id='sonar-mode'
                  value={settings.mode}
                  onValueChange={(value) =>
                    onChange({ mode: value === 'pushpull' ? 'pushpull' : 'stereo' })
                  }
                >
                  <TabsList>
                    <TabsTrigger value='stereo'>A · Stereo order</TabsTrigger>
                    <TabsTrigger value='pushpull'>B · Push / pull</TabsTrigger>
                  </TabsList>
                </Tabs>
              </SettingRow>
              <SettingRow id='sonar-fft' label='FFT size'>
                <Select
                  items={FFT_ITEMS}
                  value={String(settings.fftSize)}
                  onValueChange={(value) => {
                    const size: FftSize | undefined = FFT_SIZES.find(
                      (s) => String(s) === value
                    );
                    if (size) onChange({ fftSize: size });
                  }}
                >
                  <SelectTrigger id='sonar-fft' className='w-40'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FFT_ITEMS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <div className='flex items-center justify-between gap-4'>
                <Label htmlFor='sonar-invert'>Invert direction</Label>
                <Switch
                  id='sonar-invert'
                  checked={settings.invertDirection}
                  onCheckedChange={(checked) => onChange({ invertDirection: checked })}
                />
              </div>
              <div className='flex items-center justify-between gap-4'>
                <Label htmlFor='sonar-auto'>Pick tones automatically on Calibrate</Label>
                <Switch
                  id='sonar-auto'
                  checked={settings.autoSelectTones}
                  onCheckedChange={(checked) => onChange({ autoSelectTones: checked })}
                />
              </div>
            </div>
            <div className='grid gap-6 sm:grid-cols-2'>
              {SETTING_SLIDERS.map((def) => {
                const id = `sonar-${def.key}`;
                const value = settings[def.key];
                return (
                  <SettingRow
                    key={def.key}
                    id={id}
                    label={def.label}
                    value={`${formatValue(value, def.displayScale, def.step)} ${def.unit}`}
                  >
                    <Slider
                      id={id}
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={[value]}
                      onValueChange={(next) => {
                        const n = typeof next === 'number' ? next : next[0];
                        if (typeof n === 'number')
                          onChange(withNumber(settings, def.key, n));
                      }}
                    />
                  </SettingRow>
                );
              })}
            </div>
            <Text variant='muted' size='xs'>
              Changing a tone or the FFT size re-captures the stillness baseline.
              Threshold changes apply at once; press Calibrate to re-measure the baseline
              with them.
            </Text>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  );
}
