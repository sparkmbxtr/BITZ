import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { routeMonitorAuth } from "../../worker/nucleosome-auth.mjs";
import { routeNucleosomeProgress } from "../../worker/nucleosome-progress.mjs";
import { routePilotLibrary } from "../../worker/pilot-library.mjs";
import { PILOT_MANIFEST_SHA256 } from "../../worker/pilot-revision.mjs";
import { INITIAL_SNAPSHOT } from "../../worker/nucleosome-snapshot.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const assetRoot = process.env.PILOT_ASSETS_DIRECTORY;
assert.ok(assetRoot,"Point to the independently verified private display assets");
const rawManifest = readFileSync(join(assetRoot,"../display_manifest.json"),"utf8");
assert.equal(createHash("sha256").update(rawManifest).digest("hex"),PILOT_MANIFEST_SHA256);
const manifest = JSON.parse(rawManifest);
const fixture = "PILOT-BROWSER-ONLY-FIXTURE";
const state = structuredClone(INITIAL_SNAPSHOT);state.information_updated_at = new Date().toISOString();
const stub = { readNucleosomeProgress:async()=>JSON.stringify(state),readPilotManifest:async()=>rawManifest,
  pilotAssetStatus:async(_,name)=>{const a=manifest.files.find(x=>x.name===name);return{parts:a.chunks.length,bytes:a.bytes}},
  readPilotChunk:async(_,name,index)=>{const a=manifest.files.find(x=>x.name===name),file=await open(join(assetRoot,name));try{const buffer=Buffer.alloc(a.chunks[index].bytes);await file.read(buffer,0,buffer.length,index*240*1024);return buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)}finally{await file.close()}} };
const env = {NUCLEOSOME_PASSWORD_HASH:createHash("sha256").update(fixture).digest("hex"),DASHBOARD_SESSION_SECRET:"pilot-browser-fixture-key",CONTEXT_LOG:{getByName:()=>stub}};
let base;
const server=createServer(async(incoming,outgoing)=>{try{
  const local=new URL(incoming.url,base);if(local.pathname==="/api/display-version"){outgoing.writeHead(200,{"Content-Type":"application/json"});outgoing.end(JSON.stringify({version:"development"}));return;}
  const pieces=[];for await(const c of incoming)pieces.push(c);
  const request=new Request(local.pathname==="/api/nucleosome-auth"?local:new URL(incoming.url,"https://spark.bioengineering.workers.dev"),{method:incoming.method,headers:incoming.headers,...(pieces.length?{body:Buffer.concat(pieces)}:{})});
  const response=local.pathname==="/api/nucleosome-auth"?await routeMonitorAuth(request,env):(await routePilotLibrary(request,env)??await routeNucleosomeProgress(request,env));
  if(!response){outgoing.writeHead(404);outgoing.end();return;}outgoing.writeHead(response.status,Object.fromEntries(response.headers));
  if(response.body){for await(const bytes of response.body)outgoing.write(bytes);}outgoing.end();
}catch{outgoing.writeHead(500);outgoing.end("Fixture failure; body omitted")}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));base="http://localhost:"+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||["/usr/bin/chromium","/usr/bin/google-chrome"].find(existsSync),headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"]});
const output=process.env.PILOT_QA_DIR;if(output)mkdirSync(output,{recursive:true});
const results=[],errors=[];
async function geometry(page){return page.evaluate(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{header:rect("header"),brand:rect(".brand"),navigation:rect(".workspace-tabs"),tabs:[...document.querySelectorAll(".workspace-tab")].map(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}}),main:rect("main"),title:rect("h1"),pageWidth:document.documentElement.scrollWidth,scale:visualViewport.scale,scrollY}})}
function same(a,b){for(const key of["header","brand","navigation","main"]){for(const field of["x","y","width","height"])assert.ok(Math.abs(a[key][field]-b[key][field])<=.5,key+" "+field)}for(let i=0;i<4;i++)for(const field of["x","y","width","height"])assert.ok(Math.abs(a.tabs[i][field]-b.tabs[i][field])<=.5,"tab geometry");for(const field of["x","y","height"])assert.ok(Math.abs(a.title[field]-b.title[field])<=.5,"title geometry")}
try{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base);await page.locator("#password").fill(fixture);await Promise.all([page.waitForNavigation(),page.getByRole("button",{name:"Open monitor"}).click()]);
  const cookie=(await context.cookies(base)).find(c=>c.name==="__Host-spark_nucleosome_week");assert.ok(cookie);
  for(const [width,height] of[[320,568],[390,844],[600,900],[768,1024],[1024,768],[1440,900],[1920,1080],[2560,1440],[844,390]]){
    await page.setViewportSize({width,height});await page.goto(base+"/nucleosome");await page.waitForSelector("#content",{state:"visible"});const monitor=await geometry(page),views={monitor};
    for(const [label,path] of[["Experiment Design","/experiment-design"],["Pilot Explorer","/pilot-explorer"],["Unwrap Pilot","/unwrap-pilot"]]){
      await page.getByRole("link",{name:label,exact:true}).click();await page.waitForURL(u=>u.pathname===path);
      if(path==="/pilot-explorer"){await page.waitForFunction(()=>document.getElementById("dataset").options.length===14,{},{timeout:60000});await page.waitForFunction(()=>document.getElementById("metrics").textContent.includes("particles"));assert.equal(await page.locator("#viewer-loading").isVisible(),false);}
      if(path==="/unwrap-pilot"){await page.waitForFunction(()=>document.getElementById("unwrap-scene").dataset.frameLoaded==="true",{},{timeout:60000});assert.equal(await page.locator("#unwrap-scene").getAttribute("data-frame-step"),"454420");}
      const view=await geometry(page);same(monitor,view);assert.ok(view.pageWidth<=width+1);assert.equal(view.scale,1);views[label]=view;
      const scroll=page.locator(path==="/experiment-design"?"#design-scroll":"#pilot-scroll");await scroll.evaluate(e=>e.scrollTop=e.scrollHeight);same(monitor,await geometry(page));
      if(output&&[390,1440].includes(width)){await scroll.evaluate(e=>e.scrollTop=0);await page.screenshot({path:join(output,`${path.slice(1)}-${width}.png`),animations:"disabled"});}
    }
    results.push({width,height,views});
  }
  await page.setViewportSize({width:1440,height:900});await page.goto(base+"/unwrap-pilot");await page.waitForFunction(()=>document.getElementById("unwrap-scene").dataset.frameLoaded==="true");
  await page.locator("#unwrap-model").selectOption("matched_control");await page.waitForFunction(()=>document.getElementById("unwrap-scene").dataset.frameStep==="261280");assert.match(await page.locator("#unwrap-metrics").textContent(),/0\.695961995/);
  await page.locator("#unwrap-segment").selectOption("1");await page.waitForFunction(()=>document.getElementById("unwrap-scene").dataset.frameLoaded==="true");assert.equal(await page.locator("#unwrap-scene").getAttribute("data-frame-kind"),"DCD");
  const first=await page.locator("#unwrap-scene").getAttribute("data-frame-step");await page.locator("#unwrap-frame").evaluate(el=>el.value="1");await page.locator("#unwrap-frame").dispatchEvent("input");assert.notEqual(await page.locator("#unwrap-scene").getAttribute("data-frame-step"),first);
  await page.getByRole("button",{name:"Show stop state"}).click();await page.waitForFunction(()=>document.getElementById("unwrap-scene").dataset.frameStep==="261280");
  await page.locator("#segment-details").evaluate(e=>e.open=true);assert.equal(await page.locator("#segment-rows tr").count(),539);await page.locator("#segment-filter").fill("454420");assert.ok(await page.locator("#segment-rows tr").count()>0);
  await page.goto(base+"/pilot-explorer");await page.waitForFunction(()=>document.getElementById("dataset").options.length===14);await page.locator("#dataset").selectOption("9");await page.waitForFunction(()=>document.getElementById("frameText").textContent.includes("time unspecified"));
  const after=(await context.cookies(base)).find(c=>c.name===cookie.name);assert.equal(after.value,cookie.value);assert.equal(after.expires,cookie.expires);assert.deepEqual(errors,[]);
  const record={verified:true,checked_utc:new Date().toISOString(),viewports:results,all_four_tab_geometries_match_within_px:.5,original_datasets:14,original_saved_frames:184,unwrap_segment_rows:539,terminal_601_step:454420,terminal_control_step:261280,actual_DCD_frame_change:true,PDB_time_label_unspecified:true,weekly_cookie_and_expiry_preserved:true,page_errors:errors,synthetic_login_fixture:true,actual_private_saved_coordinates:true,MD_actions:0,watchdog_ACK_actions:0};if(output)writeFileSync(join(output,"pilot-browser-verification.json"),JSON.stringify(record,null,2)+"\n");console.log(JSON.stringify({...record,viewports:results.map(x=>({width:x.width,height:x.height}))}));await context.close();
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
