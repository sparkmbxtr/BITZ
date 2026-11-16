export const FULLSCREEN_CSS = String.raw`
html[data-fullscreen="true"],html[data-fullscreen="true"] body{width:100%;height:100%;min-height:0;margin:0;overflow:hidden}
html[data-fullscreen="true"] main,html[data-fullscreen="true"] .header-inner,html[data-fullscreen="true"] .workspace-tabs{width:100%;max-width:none;margin-left:0;margin-right:0}
.header-actions{display:flex;align-items:center;gap:clamp(10px,1.4vw,24px);min-width:0}
.fullscreen-toggle{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-width:36px;min-height:34px;padding:6px 9px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text);font:inherit;font-size:13px;cursor:pointer;flex-shrink:0}
.fullscreen-toggle:hover{background:var(--panel);border-color:var(--muted)}
.fullscreen-toggle:focus-visible{outline:2px solid var(--cyan);outline-offset:3px}
.fullscreen-toggle svg{width:17px;height:17px;display:block}
@media(max-width:700px),(max-height:500px){.fullscreen-label{display:none}.fullscreen-toggle{min-width:30px;min-height:28px;padding:4px 6px}.header-actions{gap:10px}}
`;

export const FULLSCREEN_HTML = String.raw`<button id="fullscreen-toggle" class="fullscreen-toggle" type="button" aria-label="Enter full screen" aria-pressed="false" title="Enter full screen" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></svg><span class="fullscreen-label" id="fullscreen-label">Full screen</span></button><span id="fullscreen-message" class="sr-only" role="status" aria-live="polite"></span>`;

export function createFullscreenControl(doc, win, onChange) {
  const button=doc.getElementById("fullscreen-toggle");
  if(!button)return {toggle:async()=>false};
  const label=doc.getElementById("fullscreen-label"),message=doc.getElementById("fullscreen-message");
  const root=doc.documentElement;
  if(!root){button.hidden=true;return {toggle:async()=>false};}
  const enter=root.requestFullscreen||root.webkitRequestFullscreen;
  const exit=doc.exitFullscreen||doc.webkitExitFullscreen;
  const enabled=(root.requestFullscreen?doc.fullscreenEnabled!==false:doc.webkitFullscreenEnabled!==false)&&typeof enter==="function"&&typeof exit==="function";
  const active=()=>Boolean(doc.fullscreenElement||doc.webkitFullscreenElement);
  function sync(){
    const full=active(),text=full?"Exit full screen":"Enter full screen";
    if(root.setAttribute)root.setAttribute("data-fullscreen",String(full));
    button.setAttribute("aria-pressed",String(full));button.setAttribute("aria-label",text);button.title=text;
    if(label)label.textContent=full?"Exit full screen":"Full screen";
    if(onChange)onChange();
  }
  async function toggle(){
    if(!enabled)return false;
    try{
      if(active())await exit.call(doc);else await enter.call(root);
      if(message)message.textContent="";sync();return true;
    }catch{
      sync();if(message)message.textContent="Full screen is unavailable in this browser.";
      return false;
    }
  }
  button.hidden=!enabled;
  if(enabled){
    button.addEventListener("click",toggle);
    doc.addEventListener("fullscreenchange",sync);doc.addEventListener("webkitfullscreenchange",sync);
    sync();
  }
  return {toggle};
}
