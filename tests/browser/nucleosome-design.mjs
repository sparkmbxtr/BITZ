// Real installed Chromium; local authentication and synthetic observations only.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createServer} from "node:http";
import {createRequire} from "node:module";
import {mkdirSync,writeFileSync} from "node:fs";
import {routeMonitorAuth} from "../../worker/nucleosome-auth.mjs";
import {routeNucleosomeProgress} from "../../worker/nucleosome-progress.mjs";
import {INITIAL_SNAPSHOT} from "../../worker/nucleosome-snapshot.mjs";
import {validateValidationData} from "../../worker/nucleosome-validation-data.mjs";

const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||"playwright-core");
const state=structuredClone(INITIAL_SNAPSHOT),at=new Date().toISOString();
state.information_updated_at=at;
state.jobs.forEach(j=>Object.assign(j,{step:100000,status:"completed",guards_pass:true,checkpoint_at:at}));
state.history=[{at,step:600000}];state.watchdog_armed=true;delete state.runtime_observation;delete state.compute_rate;
state.controls=["free-601-A","free-601-B","free-601-C","free-control-A","free-control-B","free-control-C","apo-A","apo-B","apo-C"].map(id=>({id,step:100000,cap:100000,status:"completed",native_step:100000,guard_rows:5001,guards_pass:true,checkpoint_at:at}));
state.stages.forEach(s=>{s.state=["audit","baseline","components"].includes(s.id)?"complete":"pending"});
state.activities=[{label:"Stage D: numerical qualification",state:"complete",detail:"Synthetic completed milestone."},
 {label:"Validation data",state:"active",detail:"Synthetic recording.",validation_data:validateValidationData({version:1,budget_approved:true,dt_fs:1,sample_interval_steps:20,force_pN:0,
 models:[{id:"exact_601",step:400,cap:1000,status:"running",guards_pass:true,recorded_at:at},
 {id:"matched_control",step:0,cap:1000,status:"prepared",guards_pass:null,recorded_at:null}],
 accounting:{prior_charged_steps_per_model:200,cumulative_cap_steps_per_model:1200,component_budgets_unchanged:true}},at)}];
state.next_actions=["Finish the reviewed recording and assess its coverage."];
const fixture="DESIGN-VALIDATION-LOCAL-FIXTURE";
const env={NUCLEOSOME_PASSWORD_HASH:createHash("sha256").update(fixture).digest("hex"),DASHBOARD_SESSION_SECRET:"design-validation-local-only",
 CONTEXT_LOG:{getByName:()=>({readNucleosomeProgress:async()=>JSON.stringify(state)})}};
let base;const version="a".repeat(24);
const server=createServer(async(incoming,outgoing)=>{
 try{
  const local=new URL(incoming.url,base);
  if(local.pathname==="/api/display-version"){
   outgoing.writeHead(200,{"content-type":"application/json"});outgoing.end(JSON.stringify({version}));return;
  }
  const chunks=[];for await(const chunk of incoming)chunks.push(chunk);
  const request=new Request(local.pathname==="/api/nucleosome-auth"?local:new URL(incoming.url,"https://spark.bioengineering.workers.dev"),{
   method:incoming.method,headers:Object.fromEntries(Object.entries(incoming.headers).filter(([,v])=>v!==undefined)),...(chunks.length?{body:Buffer.concat(chunks)}:{})});
  const response=local.pathname==="/api/nucleosome-auth"?await routeMonitorAuth(request,env):await routeNucleosomeProgress(request,env);
  if(!response){outgoing.writeHead(404);outgoing.end();return;}
  outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end((await response.text()).replaceAll("development",version));
 }catch{outgoing.writeHead(500);outgoing.end("Local fixture failed; body omitted")}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));base="http://localhost:"+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||"/usr/bin/chromium",headless:true,
 args:["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"]});
const output=process.env.DESIGN_VALIDATION_QA_DIR;if(output)mkdirSync(output,{recursive:true});
const checks=[];
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
 page.on("pageerror",e=>errors.push(e.message));
 await page.clock.install({time:new Date()});
 await context.addInitScript(()=>Object.defineProperty(window,"sessionStorage",{get(){throw new DOMException("Fixture disabled","SecurityError")}}));
 await page.goto(base+"/experiment-design",{waitUntil:"domcontentloaded"});assert.equal(await page.locator("#design-validation").count(),0);
 await page.locator("#password").fill(fixture);
 await Promise.all([page.waitForNavigation({waitUntil:"domcontentloaded"}),page.locator('button[type="submit"]').click()]);
 const before=(await context.cookies(base)).find(c=>c.name==="__Host-spark_nucleosome_week");assert.ok(before);
 await page.getByRole("link",{name:"Experiment Design",exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll(".design-validation-run").length===2);
 assert.match(await page.locator("#design-validation-budget").textContent(),/1,200 cumulative steps = 200 prior qualification \+ 1,000 new data steps/);
 assert.match(await page.locator("#design-validation-target").textContent(),/51 samples/);
 assert.match(await page.locator("#design-live-summary").textContent(),/Six bound baselines complete; nine component controls complete; numerical qualification complete/);
 const palette=await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor,ink:getComputedStyle(document.body).color}));
 assert.deepEqual(palette,{bg:"rgb(243, 215, 128)",ink:"rgb(75, 27, 49)"});
 for(const [width,height] of [[320,568],[390,844],[844,390],[1280,720],[1920,1080],[3840,2160]]){
  await page.setViewportSize({width,height});
  await page.evaluate(()=>{const s=document.querySelector("#design-scroll"),v=document.querySelector("#validation-data");s.scrollTo({top:v.offsetTop-s.offsetTop,behavior:"instant"})});
  const view=await page.evaluate(()=>{
   const boxes=[...document.querySelectorAll(".design-validation-run,.design-validation-stats,.design-validation-plan dd")];
   return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
    tabs:document.querySelectorAll(".workspace-tab").length,contents:document.querySelectorAll(".contents a").length,
    clipping:boxes.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className),
    bars:[...document.querySelectorAll('.design-validation-track')].map(e=>({value:e.getAttribute("aria-valuenow"),max:e.getAttribute("aria-valuemax"),color:getComputedStyle(e.firstElementChild).backgroundColor})),
    navBottom:document.querySelector(".workspace-tabs").getBoundingClientRect().bottom};
  });
  assert.ok(view.scrollWidth<=width+1);assert.ok(view.scrollHeight<=height+1);assert.ok(view.navBottom<height);
  assert.equal(view.tabs,4);assert.equal(view.contents,8);assert.deepEqual(view.clipping,[]);
  assert.deepEqual(view.bars.map(b=>b.value),["400","0"]);assert.ok(view.bars.every(b=>b.color==="rgb(40, 109, 78)"));
  if(output&&(width===390||width===1920))await page.screenshot({path:output+"/design-validation-"+width+".png"});
  await page.locator("#references").scrollIntoViewIfNeeded();assert.ok(await page.locator("#references").isVisible());
  checks.push({kind:"design",...view});
 }
 const url=page.url();state.information_updated_at=new Date(Date.now()+1000).toISOString();
 state.activities[1].validation_data.models[0].step=600;state.activities[1].validation_data.models[0].recorded_at=state.information_updated_at;
 await page.clock.fastForward(31000);await page.waitForFunction(()=>document.querySelector('.design-validation-track').getAttribute("aria-valuenow")==="600");
 assert.equal(page.url(),url);assert.match(await page.locator("#design-live-summary").textContent(),/600 \/ 1,000/);
 state.activities[1].state="blocked";state.activities[1].validation_data.models[0].status="stopped";
 state.activities[1].validation_data.models[0].guards_pass=false;state.activities[1].validation_data.status="stopped";
 await page.clock.fastForward(31000);await page.waitForFunction(()=>document.querySelector('#design-validation-phase').textContent.includes("stopped for review"));
 assert.equal(await page.locator('.design-validation-track').first().getAttribute("aria-valuenow"),"600");
 state.activities[1].state="active";state.activities[1].validation_data.models[0].status="running";
 state.activities[1].validation_data.models[0].guards_pass=true;state.activities[1].validation_data.status="running";
 for(const [width,height] of [[390,844],[844,390],[1280,720],[1920,1080],[3840,2160]]){
  await page.setViewportSize({width,height});await page.goto(base+"/nucleosome",{waitUntil:"domcontentloaded"});
  await page.waitForFunction(()=>document.querySelectorAll('.validation-run').length===2);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const view=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,
   left:document.querySelector('#completed-runs').getBoundingClientRect().right,right:document.querySelector('#validation-panel').getBoundingClientRect().left,
   fullscreen:document.querySelectorAll('#fullscreen-toggle').length,controls:document.querySelectorAll('[data-control-id]').length,
   saved:[...document.querySelectorAll('#validation-panel [role="progressbar"]')].map(e=>e.getAttribute('aria-valuenow'))}));
  assert.ok(view.scrollWidth<=width+1);assert.ok(view.scrollHeight<=height+1);assert.ok(view.left<=view.right+1);
  assert.equal(view.controls,9);assert.equal(view.fullscreen,1);assert.deepEqual(view.saved,["600","0"]);checks.push({kind:"status",...view});
 }
 await page.locator('#fullscreen-toggle').click();await page.waitForFunction(()=>!!document.fullscreenElement);
 await page.locator('#fullscreen-toggle').click();await page.waitForFunction(()=>!document.fullscreenElement);
 await page.getByRole("link",{name:"Experiment Design",exact:true}).focus();await page.keyboard.press("Enter");
 await page.waitForURL("**/experiment-design");await page.waitForFunction(()=>document.querySelectorAll('.design-validation-run').length===2);
 const after=(await context.cookies(base)).find(c=>c.name===before.name);assert.equal(after.value,before.value);assert.equal(after.expires,before.expires);
 assert.deepEqual(errors,[]);
 const result={all_passed:true,checks,native_login:true,unchanged_cookie_value_and_expiry:true,live_progress_without_navigation:true,
  stopped_recording_retained:true,single_fullscreen:true,keyboard_tabs:true,sessionStorage_disabled_supported:true,page_errors:errors,scientific_actions:false};
 if(output)writeFileSync(output+"/ACTUAL_CHROMIUM_EXPERIMENT_DESIGN_VALIDATION.json",JSON.stringify(result,null,2)+"\n");
 console.log(JSON.stringify(result));await context.close();
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
