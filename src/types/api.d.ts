import type { PlannerApi } from '../../electron/preload';

declare global {
  interface Window {
    api: PlannerApi;
  }
}

export {};
