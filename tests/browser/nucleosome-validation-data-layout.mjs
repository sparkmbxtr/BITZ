// Installed Chromium, local fixture auth and generic synthetic progress only.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {existsSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {routeMonitorAuth} from "../../worker/nucleosome-auth.mjs";
import {routeNucleosomeProgress} from "../../worker/nucleosome-progress.mjs";
import {INITIAL_SNAPSHOT} from "../../worker/nucleosome-snapshot.mjs";

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||"playwright-core");
const executablePath=process.env.CHROMIUM_PATH||"/usr/bin/chromium";
assert.ok(existsSync(executablePath));
const fixture="VALIDATION-DATA-LOCAL-FIXTURE";
const state=process.env.VALIDATION_LAYOUT_SOURCE?JSON.parse(readFileSync(process.env.VALIDATION_LAYOUT_SOURCE,"utf8")):structuredClone(INITIAL_SNAPSHOT);
if(!process.env.VALIDATION_LAYOUT_SOURCE){
 state.information_updated_at=new Date().toISOString();
 state.jobs.forEach(j=>Object.assign(j,{step:100000,status:"completed",guards_pass:true,checkpoint_at:state.information_updated_at}));
 state.history=[{at:state.information_updated_at,step:600000}];
 state.controls=["free-601-A","free-601-B","free-601-C","free-control-A","free-control-B","free-control-C","apo-A","apo-B","apo-C"].map(id=>({id,step:100000,cap:100000,status:"completed",native_step:100000,guard_rows:5001,guards_pass:true,checkpoint_at:state.information_updated_at}));
 state.stages.forEach(s=>{s.state=["audit","baseline","components"].includes(s.id)?"complete":"pending"});
 state.watchdog_armed=false;delete state.runtime_observation;delete state.compute_rate;
 state.activities=[{label:"Validation data",state:"blocked",detail:"Recordings prepared; awaiting budget approval."}];
 state.next_actions=["Approve the recording budget, then record the dense trajectories."];
 state.activities[0].validation_data={version:1,budget_approved:false,dt_fs:1,sample_interval_steps:20,force_pN:0,
  models:["exact_601","matched_control"].map(id=>({id,step:0,cap:5000,status:"prepared",guards_pass:null,recorded_at:null}))};
}
const env={NUCLEOSOME_PASSWORD_HASH:createHash("sha256").update(fixture).digest("hex"),DASHBOARD_SESSION_SECRET:"local-validation-layout-fixture-only",
 CONTEXT_LOG:{getByName:()=>({readNucleosomeProgress:async()=>JSON.stringify(state)})}};
let base;
const server=createServer(async(incoming,outgoing)=>{
 try{
  const chunks=[];for await(const chunk of incoming)chunks.push(chunk);
  const local=new URL(incoming.url,base),request=new Request(local.pathname==="/api/nucleosome-auth"?local:new URL(incoming.url,"https://spark.bioengineering.workers.dev"),{
   method:incoming.method,headers:Object.fromEntries(Object.entries(incoming.headers).filter(([,v])=>v!==undefined)),...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  const response=local.pathname==="/api/nucleosome-auth"?await routeMonitorAuth(request,env):await routeNucleosomeProgress(request,env);
  if(!response){outgoing.writeHead(404);outgoing.end();return;}
  outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(await response.text());
 }catch{outgoing.writeHead(500);outgoing.end("Local layout fixture failed; body omitted")}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));base="http://localhost:"+server.address().port;
const browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"]});
const output=process.env.VALIDATION_LAYOUT_QA_DIR;if(output)mkdirSync(output,{recursive:true});
const results=[];
async function check(page,label){
 await page.evaluate(()=>document.fonts.ready);
 const value=await page.evaluate(()=>{
  const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};
  const root=document.querySelector("#content"),completed=document.querySelector("#completed-runs"),validation=document.querySelector("#validation-panel");
  const clipping=[];
  for(const e of document.querySelectorAll(".control-run,.validation-run,.validation-state,.validation-stats,.stage-detail")){
   if(!e.getClientRects().length)continue;const r=rect(e),panel=e.closest(".panel,.stage"),p=rect(panel);
   if(r.right>p.right+1||r.bottom>p.bottom+1||e.scrollWidth>e.clientWidth+1)clipping.push({class:e.className,text:e.textContent,rect:r,panel:p,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth});
  }
  return {width:innerWidth,height:innerHeight,density:root.dataset.density,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
   completed:rect(completed),validation:rect(validation),controls:Array.from(document.querySelectorAll("[data-control-id]")).map(e=>({id:e.dataset.controlId,rect:rect(e)})),
   validationBars:Array.from(validation.querySelectorAll('[role="progressbar"]')).map(e=>({value:e.getAttribute("aria-valuenow"),max:e.getAttribute("aria-valuemax"),fill:getComputedStyle(e.firstElementChild).backgroundColor})),
   state:document.querySelector("#validation-state").textContent,total:document.querySelector("#validation-total").textContent,
   fullscreenButtons:document.querySelectorAll("#fullscreen-toggle").length,tabs:document.querySelectorAll(".workspace-tab").length,clipping};
 });
 assert.equal(value.scrollWidth,value.width,label+" horizontal scroll");assert.ok(value.scrollHeight<=value.height+1,label+" vertical scroll");
 assert.ok(value.completed.right<=value.validation.x+1,label+" completed rows must stay left");
 assert.equal(value.controls.length,9);assert.ok(value.controls.every(r=>r.rect.right<=value.validation.x+1));
 assert.equal(value.validationBars.length,2);assert.deepEqual(value.validationBars.map(b=>b.value),["0","0"]);
 assert.equal(value.state,"Awaiting budget approval");assert.equal(value.total,"0 / 10,000 steps");
 assert.equal(value.fullscreenButtons,1);assert.equal(value.tabs,4);assert.deepEqual(value.clipping,[],label+" clipping");
 results.push({label,...value});
}
try{
 for(const [width,height] of [[3840,2160],[1920,1080],[1280,720],[900,600],[390,844],[844,390]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base,{waitUntil:"domcontentloaded"});await page.locator("#password").fill(fixture);
  await Promise.all([page.waitForNavigation({waitUntil:"domcontentloaded"}),page.locator('button[type="submit"]').click()]);
  await page.waitForFunction(()=>document.querySelectorAll(".validation-run").length===2);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await check(page,width+"x"+height+" normal");
  if(output)await page.screenshot({path:output+"/validation-"+width+"x"+height+".png"});
  if(width===1920||width===390){
   await page.locator("#fullscreen-toggle").click();await page.waitForFunction(()=>!!document.fullscreenElement);await check(page,width+"x"+height+" fullscreen");
   await page.locator("#fullscreen-toggle").click();await page.waitForFunction(()=>!document.fullscreenElement);await check(page,width+"x"+height+" exit");
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 if(output)writeFileSync(output+"/ACTUAL_CHROMIUM_VALIDATION_LAYOUT.json",JSON.stringify({all_passed:true,results},null,2)+"\n");
 console.log(JSON.stringify({all_passed:true,cases:results.length,results}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
