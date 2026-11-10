// Add future workspace sections here; each section owns its route and theme.
export const WORKSPACE_TABS = Object.freeze([
  Object.freeze({ id: "nucleosome-c", label: "Nucleosome-C", href: "/nucleosome" }),
  Object.freeze({ id: "experiment-design", label: "Experiment Design", href: "/experiment-design" }),
]);

export function workspaceNavigation(activeId) {
  if (!WORKSPACE_TABS.some(tab => tab.id === activeId)) throw new Error("Unknown workspace section");
  const escape = value => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return '<nav class="workspace-tabs" aria-label="Workspace sections">' + WORKSPACE_TABS.map(tab =>
    '<a class="workspace-tab" id="tab-' + escape(tab.id) + '" href="' + escape(tab.href) + '"' +
    (tab.id === activeId ? ' aria-current="page"' : '') + '>' + escape(tab.label) + '</a>'
  ).join("") + '</nav>';
}
