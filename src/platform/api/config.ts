// Backend base URL. Empty string => sync disabled (pure local/offline mode),
// so an unconfigured PWA behaves exactly as before (guest, IndexedDB only).
const raw = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
export const API_BASE = raw.replace(/\/+$/, '');
export const SYNC_ENABLED = API_BASE.length > 0;
