import test from "node:test";
import assert from "node:assert/strict";
import {createFullscreenControl} from "../worker/nucleosome-fullscreen.mjs";

function fixture({webkit=false,reject=false,unsupported=false}={}){
 const listeners={},attrs={},button={hidden:true,setAttribute:(k,v)=>attrs[k]=v,addEventListener:(k,v)=>listeners['button:'+k]=v},label={},message={};
 const elements={"fullscreen-toggle":button,"fullscreen-label":label,"fullscreen-message":message};
 const doc={documentElement:{},getElementById:id=>elements[id],addEventListener:(name,fn)=>listeners[name]=fn};
 const field=webkit?'webkitFullscreenElement':'fullscreenElement',event=webkit?'webkitfullscreenchange':'fullscreenchange';
 let resize=0;
 if(!unsupported){
  doc.documentElement[webkit?'webkitRequestFullscreen':'requestFullscreen']=async function(){assert.equal(this,doc.documentElement);if(reject)throw Error('unsupported');doc[field]=this;listeners[event]?.()};
  doc[webkit?'webkitExitFullscreen':'exitFullscreen']=async function(){assert.equal(this,doc);doc[field]=null;listeners[event]?.()};
 }
 const api=createFullscreenControl(doc,{},()=>resize++);
 return {doc,listeners,attrs,button,label,message,api,field,event,resize:()=>resize};
}

test('fullscreen enters and exits only on a user gesture and keeps accessible state in sync',async()=>{
 const f=fixture();assert.equal(f.doc.fullscreenElement,undefined);assert.equal(f.button.hidden,false);assert.equal(f.attrs['aria-pressed'],'false');
 await f.listeners['button:click']();assert.equal(f.doc.fullscreenElement,f.doc.documentElement);assert.equal(f.attrs['aria-label'],'Exit full screen');assert.equal(f.attrs['aria-pressed'],'true');
 await f.listeners['button:click']();assert.equal(f.doc.fullscreenElement,null);assert.equal(f.attrs['aria-label'],'Enter full screen');assert.equal(f.label.textContent,'Full screen');assert.ok(f.resize()>1);
});

test('browser Escape updates the toggle and refits the single-view display',async()=>{
 const f=fixture();await f.api.toggle();const before=f.resize();f.doc.fullscreenElement=null;f.listeners.fullscreenchange();
 assert.equal(f.attrs['aria-pressed'],'false');assert.equal(f.attrs['aria-label'],'Enter full screen');assert.ok(f.resize()>before);
});

test('Safari prefix uses its actual fullscreen state',async()=>{
 const f=fixture({webkit:true});await f.api.toggle();assert.equal(f.attrs['aria-pressed'],'true');await f.api.toggle();assert.equal(f.attrs['aria-pressed'],'false');
});

test('request rejection leaves progress visible and exposes an accessible explanation',async()=>{
 const f=fixture({reject:true});assert.equal(await f.api.toggle(),false);assert.equal(f.attrs['aria-pressed'],'false');assert.match(f.message.textContent,/unavailable/);
});

test('unsupported or policy-disabled fullscreen does not show a nonfunctional control',()=>{
 const f=fixture({unsupported:true});assert.equal(f.button.hidden,true);assert.equal(f.listeners['button:click'],undefined);
});
