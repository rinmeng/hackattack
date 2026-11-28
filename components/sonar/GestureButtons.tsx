'use client';

import { useEffect, useRef, useState } from 'react';

import { ArrowLeft, ArrowRight } from 'lucide-react';

import type { GestureDirection, GestureSource, SonarSubscribe } from '@/lib/types';
import { FLASH_MS } from '@/lib/sonar/constants';
import { cn } from '@/lib/utils';
import { Button, Kbd } from '@/components/ui';
import { Text } from '@/components/Text';

interface GestureButtonsProps {
  on: SonarSubscribe;
  counts: Record<GestureDirection, number>;
  onPress: (direction: GestureDirection) => void;
}

const SOURCE_LABELS: Record<GestureSource, string> = {
  sonar: 'sonar',
  keyboard: 'keyboard',
  click: 'click',
};

/** The two big LEFT/RIGHT targets. They flash and scale for 300 ms on each trigger. */
export function GestureButtons({ on, counts, onPress }: GestureButtonsProps) {
  const [flashing, setFlashing] = useState<Record<GestureDirection, boolean>>({
    left: false,
    right: false,
  });
  const [lastSource, setLastSource] = useState<
    Record<GestureDirection, GestureSource | null>
  >({ left: null, right: null });
  const timers = useRef<Record<GestureDirection, number>>({ left: 0, right: 0 });

  useEffect(() => {
    const pending = timers.current;
    const flash = (direction: GestureDirection, source: GestureSource) => {
      setFlashing((prev) => ({ ...prev, [direction]: true }));
      setLastSource((prev) => ({ ...prev, [direction]: source }));
      window.clearTimeout(pending[direction]);
      pending[direction] = window.setTimeout(() => {
        setFlashing((prev) => ({ ...prev, [direction]: false }));
      }, FLASH_MS);
    };
    const offLeft = on('left', (event) => flash('left', event.source));
    const offRight = on('right', (event) => flash('right', event.source));
    return () => {
      offLeft();
      offRight();
      window.clearTimeout(pending.left);
      window.clearTimeout(pending.right);
    };
  }, [on]);

  const directions: GestureDirection[] = ['left', 'right'];

  return (
    <div className='grid grid-cols-2 gap-4'>
      {directions.map((direction) => {
        const Icon = direction === 'left' ? ArrowLeft : ArrowRight;
        const source = lastSource[direction];
        return (
          <Button
            key={direction}
            variant='outline'
            onClick={() => onPress(direction)}
            aria-label={`${direction} (${counts[direction]} triggers)`}
            className={cn(
              'h-44 flex-col gap-3 transition-all duration-300 md:h-56',
              flashing[direction] &&
                'scale-105 bg-primary text-primary-foreground hover:bg-primary'
            )}
          >
            <Icon className='size-12! md:size-16!' />
            <Text variant='hd-xl' as='span'>
              {direction.toUpperCase()}
            </Text>
            <Text as='span' size='sm' className='tabular-nums'>
              {counts[direction]} {counts[direction] === 1 ? 'trigger' : 'triggers'}
              {source ? ` · last: ${SOURCE_LABELS[source]}` : ''}
            </Text>
            <Kbd>{direction === 'left' ? '←' : '→'}</Kbd>
          </Button>
        );
      })}
    </div>
  );
}
