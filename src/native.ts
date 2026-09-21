/**
 * Everything that talks to Capacitor lives here and is only invoked after the
 * first paint, so the list is on screen before any bridge call is made.
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

export const isNative = Capacitor.isNativePlatform();

export interface NativeHooks {
  onResume(): void;
  onBack(): boolean; // return true if handled (i.e. do not exit)
}

export async function initNative(hooks: NativeHooks): Promise<void> {
  if (!isNative) return;
  // Capgo: tell the updater the bundle booted successfully. Without this the
  // plugin rolls back to the previous bundle after a live update.
  CapacitorUpdater.notifyAppReady().catch(() => {});
  await App.addListener('resume', hooks.onResume);
  await App.addListener('backButton', () => {
    if (!hooks.onBack()) void App.exitApp();
  });
}

export async function shareCsv(filename: string, csv: string): Promise<void> {
  if (!isNative) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: csv,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: filename, url: uri, dialogTitle: 'Export todo list' });
}
