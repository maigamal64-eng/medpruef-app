export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/** A full document navigation prevents already-loaded pixels observing admin URLs. */
export function installAdminNavigationBoundary(win: Window): () => void {
  const documentIsAdmin = isAdminPath(win.location.pathname);
  const crosses = (value: string | URL | null | undefined) => {
    if (value == null) return false;
    const target = new URL(String(value), win.location.href);
    return target.origin === win.location.origin && isAdminPath(target.pathname) !== documentIsAdmin;
  };
  const originalPush = win.history.pushState;
  const originalReplace = win.history.replaceState;
  const push: History["pushState"] = function (data, unused, url) {
    if (crosses(url)) { win.location.assign(String(url)); return; }
    originalPush.call(win.history, data, unused, url);
  };
  const replace: History["replaceState"] = function (data, unused, url) {
    if (crosses(url)) { win.location.replace(String(url)); return; }
    originalReplace.call(win.history, data, unused, url);
  };
  win.history.pushState = push;
  win.history.replaceState = replace;
  const onClick = (event: MouseEvent) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a");
    if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self") || !crosses(anchor.href)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    win.location.assign(anchor.href);
  };
  const onPop = (event: PopStateEvent) => {
    if (isAdminPath(win.location.pathname) === documentIsAdmin) return;
    event.stopImmediatePropagation();
    win.location.reload();
  };
  win.addEventListener("click", onClick, true);
  win.addEventListener("popstate", onPop, true);
  return () => {
    if (win.history.pushState === push) win.history.pushState = originalPush;
    if (win.history.replaceState === replace) win.history.replaceState = originalReplace;
    win.removeEventListener("click", onClick, true);
    win.removeEventListener("popstate", onPop, true);
  };
}
