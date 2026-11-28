/**
 * Browser and page checks that can run before Start. Call only in the browser (from
 * useSyncExternalStore's client snapshot, effects or handlers).
 */
import type { SonarEnvironmentIssue } from '@/lib/types';

/** Safari's UA contains "Safari" but not Chrome/Chromium/Edge markers. */
export function isSafariUserAgent(ua: string): boolean {
  return /Safari\//.test(ua) && !/(Chrome|Chromium|CriOS|Edg|OPR|FxiOS)\//.test(ua);
}

export function isFirefoxUserAgent(ua: string): boolean {
  return /(Firefox|FxiOS)\//.test(ua);
}

export function detectEnvironmentIssue(): SonarEnvironmentIssue {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    return 'insecure-context';
  }
  if (typeof window.AudioContext !== 'function') return 'no-web-audio';
  const ua = navigator.userAgent;
  if (isSafariUserAgent(ua)) return 'safari';
  if (isFirefoxUserAgent(ua)) return 'firefox';
  return 'ok';
}
