'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Text } from '@/components/Text';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
} from '@/components/ui';
import type { WifiDetectorSettings, WifiScoreType } from '@/lib/types';
import { MS_PER_SECOND, SETTINGS_RANGES } from '@/lib/wifi-sense/constants';
import { cn } from '@/lib/utils';

const SCORE_TYPES: Record<WifiScoreType, string> = {
  mad: 'Mean absolute deviation',
  std: 'Standard deviation',
};

type SliderKey = keyof typeof SETTINGS_RANGES;

const SLIDERS: {
  key: SliderKey;
  label: string;
  help: string;
  format: (v: number) => string;
}[] = [
  {
    key: 'windowMs',
    label: 'Window',
    help: 'How much recent signal the spread is measured over. Changing it needs recalibration.',
    format: (v) => `${v / MS_PER_SECOND} s`,
  },
  {
    key: 'k',
    label: 'k (sigmas above empty room)',
    help: 'Higher ignores more of the room’s own noise.',
    format: (v) => `${v}`,
  },
  {
    key: 'outsideFactor',
    label: 'Outside factor',
    help: 'How far above hallway motion the threshold sits.',
    format: (v) => `${v.toFixed(2)}×`,
  },
  {
    key: 'thresholdScale',
    label: 'Threshold scale',
    help: 'Below 1× catches more motion; above 1× ignores more.',
    format: (v) => `${v.toFixed(2)}×`,
  },
  {
    key: 'enterHoldMs',
    label: 'Enter hold',
    help: 'Score must stay above T this long to show MOTION.',
    format: (v) => `${v / MS_PER_SECOND} s`,
  },
  {
    key: 'exitHoldMs',
    label: 'Exit hold',
    help: 'Score must stay low this long to go back to CLEAR.',
    format: (v) => `${v / MS_PER_SECOND} s`,
  },
];

interface SettingsPanelProps {
  settings: WifiDetectorSettings;
  onChange: (patch: Partial<WifiDetectorSettings>) => void;
  onReset: () => void;
}

function isScoreType(value: unknown): value is WifiScoreType {
  return value === 'mad' || value === 'std';
}

export function SettingsPanel({ settings, onChange, onReset }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CollapsibleTrigger
            render={<Button variant='ghost' className='w-full justify-between px-0' />}
          >
            <CardTitle>Detection settings</CardTitle>
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className='flex flex-col gap-5'>
            <div className='flex flex-col gap-1'>
              <Text variant='label' size='sm'>
                Score
              </Text>
              <Select
                items={SCORE_TYPES}
                value={settings.scoreType}
                onValueChange={(value) => {
                  if (isScoreType(value)) onChange({ scoreType: value });
                }}
              >
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SCORE_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Text variant='muted' size='xs'>
                MAD is steadier when one reading is way off. Changing it needs
                recalibration.
              </Text>
            </div>
            {SLIDERS.map(({ key, label, help, format }) => {
              const range = SETTINGS_RANGES[key];
              return (
                <div key={key} className='flex flex-col gap-2'>
                  <div className='flex items-center justify-between'>
                    <Text variant='label' size='sm'>
                      {label}
                    </Text>
                    <Text size='sm' className='font-mono'>
                      {format(settings[key])}
                    </Text>
                  </div>
                  <Slider
                    aria-label={label}
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={settings[key]}
                    onValueChange={(value) => onChange({ [key]: value })}
                  />
                  <Text variant='muted' size='xs'>
                    {help}
                  </Text>
                </div>
              );
            })}
            <Button variant='outline' onClick={onReset} className='self-start'>
              Reset to defaults
            </Button>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
