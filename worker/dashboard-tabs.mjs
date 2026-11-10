// Add future workspace sections here; each section owns its route and theme.
export const WORKSPACE_TABS = Object.freeze([
  Object.freeze({ id: "nucleosome-c", label: "Nucleosome-C", href: "/nucleosome" }),
  Object.freeze({ id: "experiment-design", label: "Experiment Design", href: "/experiment-design" }),
]);

// Both sections use the same viewport, header, tab metrics and content frame.
// Long documents scroll inside that frame so a scrollbar or active label cannot
// move the navigation when a reader changes sections.
export const WORKSPACE_SHELL_CSS = String.raw`
html{height:100%;overflow:hidden}
body[data-workspace]{--workspace-gutter:clamp(14px,2.8vw,56px);--workspace-pad:clamp(10px,1.8vh,30px);--workspace-gap:clamp(8px,1.3vh,20px);height:100dvh;min-height:0;margin:0;display:grid;grid-template-rows:auto minmax(0,1fr);overflow:hidden}
body[data-workspace]>header{position:relative;top:auto;z-index:3;min-width:0;border-bottom-width:1px;border-bottom-style:solid}
body[data-workspace] .header-inner{width:100%;max-width:2000px;height:clamp(36px,5vh,60px);margin:0 auto;padding:0 var(--workspace-gutter);display:flex;justify-content:space-between;align-items:center;gap:16px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;line-height:1.5}
body[data-workspace] .brand{flex-shrink:0;font-size:15px;font-weight:650;letter-spacing:.045em}
body[data-workspace] .header-note,body[data-workspace] .header-time{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:400;line-height:1.5;text-align:right;font-variant-numeric:tabular-nums}
body[data-workspace] .workspace-tabs{width:100%;max-width:2000px;min-width:0;margin:0 auto;padding:0 var(--workspace-gutter);display:flex;align-items:stretch;gap:6px}
body[data-workspace] .workspace-tab{flex:0 0 auto;display:inline-flex;align-items:center;min-height:34px;padding:5px 17px;border:1px solid;border-bottom:0;border-radius:9px 9px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-size:12px;font-weight:600;line-height:1.5;letter-spacing:.025em;text-decoration:none;white-space:nowrap}
body[data-workspace] #tab-nucleosome-c{background:#432039;color:#efd9e9;border-color:#6a3855}
body[data-workspace] #tab-experiment-design{background:#f3d780;color:#4b1b31;border-color:#b59656}
body[data-workspace] .workspace-tab[aria-current="page"]{box-shadow:inset 0 3px currentColor}
body[data-workspace]>main{width:100%;max-width:2000px;height:100%;min-width:0;min-height:0;margin:0 auto;padding:var(--workspace-pad) var(--workspace-gutter);display:grid;grid-template-rows:auto minmax(0,1fr);gap:var(--workspace-gap);overflow:hidden}
body[data-workspace] .title-row{display:flex;min-height:34px;min-width:0;margin:0;align-items:center;justify-content:space-between;gap:12px}
body[data-workspace] .title-row h1{margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;font-size:clamp(16px,1.6vw,26px);font-weight:550;line-height:1.25;letter-spacing:-.04em;white-space:nowrap}
@media(max-width:700px){body[data-workspace]{--workspace-gutter:12px;--workspace-pad:10px;--workspace-gap:8px}body[data-workspace] .header-inner{height:32px}body[data-workspace] .brand{font-size:11px}body[data-workspace] .header-note,body[data-workspace] .header-time{font-size:10px}body[data-workspace] .workspace-tab{min-height:29px;padding:4px 12px;font-size:10px}body[data-workspace] .title-row{min-height:30px}body[data-workspace] .title-row h1{font-size:14px}}
@media(max-height:650px) and (min-width:701px){body[data-workspace]{--workspace-pad:8px;--workspace-gap:7px}body[data-workspace] .header-inner{height:32px}}
@media(max-height:600px) and (max-width:700px){body[data-workspace]{--workspace-gutter:10px;--workspace-pad:7px;--workspace-gap:4px}body[data-workspace] .header-inner{height:24px}body[data-workspace] .workspace-tab{min-height:26px;padding:3px 10px;font-size:9px}}
@media(max-height:450px){body[data-workspace]{--workspace-gutter:12px;--workspace-pad:6px;--workspace-gap:5px}body[data-workspace] .header-inner{height:24px}body[data-workspace] .workspace-tab{min-height:25px;padding:3px 12px;font-size:10px}body[data-workspace] .title-row{min-height:24px}}
@media print{html,body[data-workspace]{height:auto;overflow:visible;display:block}body[data-workspace]>main{height:auto;display:block;overflow:visible}body[data-workspace]>header{display:none}}
`;

export function workspaceNavigation(activeId) {
  if (!WORKSPACE_TABS.some(tab => tab.id === activeId)) throw new Error("Unknown workspace section");
  const escape = value => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return '<nav class="workspace-tabs" aria-label="Workspace sections">' + WORKSPACE_TABS.map(tab =>
    '<a class="workspace-tab" id="tab-' + escape(tab.id) + '" href="' + escape(tab.href) + '"' +
    (tab.id === activeId ? ' aria-current="page"' : '') + '>' + escape(tab.label) + '</a>'
  ).join("") + '</nav>';
}
