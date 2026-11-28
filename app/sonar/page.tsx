import type { Metadata } from 'next';

import { Text } from '@/components/Text';
import { SonarApp } from '@/components/sonar/SonarApp';

export const metadata: Metadata = {
  title: 'Afterlife Sonar',
  description:
    'Ultrasonic Doppler gestures from a laptop speaker and mic, reviving SoundWave (CHI 2012).',
};

export default function SonarPage() {
  return (
    <div className='container nb-padding mx-auto px-4'>
      <div className='mx-auto flex max-w-5xl flex-col gap-8'>
        <div className='flex flex-col gap-2 text-center'>
          <Text variant='hd-xl'>Afterlife Sonar</Text>
          <Text variant='muted' size='lg'>
            Your laptop plays an inaudible tone and listens to its echo: a wave of your
            hand shifts the pitch, and that fires LEFT or RIGHT.
          </Text>
        </div>
        <SonarApp />
      </div>
    </div>
  );
}
