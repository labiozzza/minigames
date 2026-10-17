export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

export function apiBase(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return location.origin;
}
