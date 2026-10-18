import type { SCurveType } from './sCurveApi';

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== 'undefined') {
    return localStorage;
  }
  return null;
}

export function getUserChartStorageKey(
  user: { id?: string; role?: string; email?: string } | null | undefined,
  projectId: string | number,
  chartKey: 'scurve' | 'barchart',
): string {
  const userIdent = user?.id || user?.role || user?.email || 'anon';
  return `cf_${chartKey}_view_${userIdent}_${projectId}`;
}

export function getLocalChartViewMode(
  user: { id?: string; role?: string; email?: string } | null | undefined,
  projectId: string | number,
  chartKey: 'scurve' | 'barchart',
): SCurveType | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const key = getUserChartStorageKey(user, projectId, chartKey);
    const val = storage.getItem(key);
    if (val === 'pdm_based' || val === 'ideal_theoretical') {
      return val;
    }
  } catch {
    // Ignore storage exceptions (e.g. storage disabled/sandbox)
  }
  return null;
}

export function setLocalChartViewMode(
  user: { id?: string; role?: string; email?: string } | null | undefined,
  projectId: string | number,
  chartKey: 'scurve' | 'barchart',
  mode: SCurveType,
): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const key = getUserChartStorageKey(user, projectId, chartKey);
    storage.setItem(key, mode);
  } catch {
    // Ignore storage exceptions
  }
}
