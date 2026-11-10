import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { PilotStorage } from "../worker/pilot-storage.mjs";
import { routePilotLibrary, validatePilotManifest, allowedPilotClaims } from "../worker/pilot-library.mjs";
import { allowedProgressClaims } from "../worker/nucleosome-oidc.mjs";
import { routeMonitorAuth } from "../worker/nucleosome-auth.mjs";

const base = "https://spark.bioengineering.workers.dev";
const digest = value => createHash("sha256").update(value).digest("hex");
const fixture = "PILOT-LIBRARY-ONLY-FIXTURE";
function setup(bytes = Buffer.from('saved historical coordinates, not a simulation')) {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(query, ...args) { const statement = db.prepare(query);
    // Cloudflare SQL binds ArrayBuffer; Node SQLite binds the corresponding view.
    args = args.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
    if (query.startsWith("SELECT")) return {toArray:() => statement.all(...args)};
    statement.run(...args);return {toArray:() => []}; } };
  const storage = new PilotStorage(sql);
  const stub = { readPilotManifest:async (...a) => storage.manifest(...a), putPilotManifest:async (...a) => storage.putManifest(...a),
    readPilotChunk:async (...a) => storage.chunk(...a), putPilotChunk:async (...a) => storage.putChunk(...a), pilotAssetStatus:async (...a) => storage.status(...a) };
  const env = { NUCLEOSOME_PASSWORD_HASH:digest(fixture), DASHBOARD_SESSION_SECRET:"pilot-fixture-key", CONTEXT_LOG:{getByName:() => stub} };
  const chunks = [];for (let i=0;i<bytes.length;i+=240*1024) {const part=bytes.subarray(i,i+240*1024);chunks.push({bytes:part.length,sha256:digest(part)});}
  const raw = JSON.stringify({version:1,files:[{name:"frames.bin",type:"application/octet-stream",bytes:bytes.length,sha256:digest(bytes),chunks}]});
  const revision = digest(raw), options={revision,authorize:async r => r.headers.get("authorization") === "fixture-writer"};
  const call = (path, init={}) => routePilotLibrary(new Request(base+"/api/pilot-library/"+path,init),env,options);
  const put = (path,body) => call(path,{method:"PUT",headers:{Authorization:"fixture-writer"},body});
  return {db,storage,sql,env,stub,bytes,raw,revision,options,call,put};
}
async function login(env) {
  const response=await routeMonitorAuth(new Request(base+"/api/nucleosome-auth",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({password:fixture})}),env);
  assert.equal(response.status,200);return response.headers.get("set-cookie").split(";",1)[0];
}

test("historical assets require the existing weekly session; login alone never permits writing",async () => {
  const s=setup();try {
    assert.equal((await s.call("manifest")).status,401);
    const Cookie=await login(s.env);
    assert.equal((await s.call("manifest",{method:"PUT",headers:{Cookie},body:s.raw})).status,401);
    assert.equal((await s.put("manifest",s.raw)).status,200);
    const response=await s.call("manifest",{headers:{Cookie}});
    assert.equal(await response.text(),s.raw);assert.match(response.headers.get("cache-control"),/no-store/);
    assert.equal(response.headers.get("set-cookie"),null);
    assert.equal(await routePilotLibrary(new Request("https://bitz.bioengineering.workers.dev/api/pilot-library/manifest"),s.env,s.options),null);
  } finally {s.db.close();}
});
test("only the frozen manifest and declared exact chunk bytes can be stored",async () => {
  const s=setup();try {
    assert.equal((await s.put("manifest",s.raw+" ")).status,409);
    assert.equal(s.storage.manifest(s.revision),null);
    assert.equal((await s.put("manifest",s.raw)).status,200);
    assert.equal((await s.put("assets/frames.bin/chunks/0","different")).status,409);
    assert.equal(s.storage.status(s.revision,"frames.bin").parts,0);
    assert.equal((await s.put("assets/frames.bin/chunks/1",s.bytes)).status,404);
    assert.equal((await s.put("assets/unknown.bin/chunks/0",s.bytes)).status,404);
    assert.equal((await s.put("assets/frames.bin/chunks/0",s.bytes)).status,200);
    assert.equal((await s.put("assets/frames.bin/chunks/0",s.bytes)).status,200);
    assert.equal(s.storage.status(s.revision,"frames.bin").parts,1);
  } finally {s.db.close();}
});
test("incomplete assets stay unavailable; complete binary data streams exactly and HEAD stays empty",async () => {
  const s=setup(Buffer.alloc(270000,42));try {
    const Cookie=await login(s.env);await s.put("manifest",s.raw);
    await s.put("assets/frames.bin/chunks/0",s.bytes.subarray(0,240*1024));
    assert.equal((await s.call("assets/frames.bin",{headers:{Cookie}})).status,503);
    await s.put("assets/frames.bin/chunks/1",s.bytes.subarray(240*1024));
    const response=await s.call("assets/frames.bin",{headers:{Cookie}});
    assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),s.bytes);
    assert.equal(response.headers.get("x-content-sha256"),digest(s.bytes));
    assert.equal(response.headers.get("set-cookie"),null);
    const head=await s.call("assets/frames.bin",{method:"HEAD",headers:{Cookie}});assert.equal(await head.text(),"");
    s.sql.exec("UPDATE pilot_chunks SET payload = ? WHERE part = 0",Buffer.alloc(240*1024,43));
    const corrupt=await s.call("assets/frames.bin",{headers:{Cookie}});
    await assert.rejects(corrupt.arrayBuffer(),/integrity/);
  } finally {s.db.close();}
});
test("immutable storage rejects replacement and preserves the prior row",() => {
  const s=setup();try {
    s.storage.putManifest(s.revision,s.raw);
    assert.throws(()=>s.storage.putManifest(s.revision,"different"),/conflict/);
    s.storage.putChunk(s.revision,"frames.bin",0,new Uint8Array([1,2]).buffer);
    assert.throws(()=>s.storage.putChunk(s.revision,"frames.bin",0,new Uint8Array([1,3]).buffer),/conflict/);
    assert.deepEqual(new Uint8Array(s.storage.chunk(s.revision,"frames.bin",0)),new Uint8Array([1,2]));
  } finally {s.db.close();}
});
test("manifest rejects duplicate/traversing paths, wrong parts and oversized capacity",() => {
  const s=setup();try {
    const value=JSON.parse(s.raw);
    for (const name of ["../escape","a/b","A.bin"]) assert.throws(()=>validatePilotManifest(JSON.stringify({...value,files:[{...value.files[0],name}]})));
    assert.throws(()=>validatePilotManifest(JSON.stringify({...value,files:[...value.files,...value.files]})));
    assert.throws(()=>validatePilotManifest(JSON.stringify({...value,files:[{...value.files[0],chunks:[]}]})));
    assert.throws(()=>validatePilotManifest(JSON.stringify({...value,files:[{...value.files[0],bytes:40*1024**2}]})));
  } finally {s.db.close();}
});
test("the one-time pilot OIDC writer is distinct from the unchanged progress writer",() => {
  const now=1804849200, claims={iss:"https://token.actions.githubusercontent.com",aud:"nucleosome-pilot-assets",repository:"sparkmbxtr/nucleosome",repository_id:"1439578026",repository_owner_id:"324419950",repository_visibility:"private",ref:"refs/heads/codex/nucleosome-c-sync",workflow_ref:"sparkmbxtr/nucleosome/.github/workflows/publish-historical-pilots-20261110.yml@refs/heads/codex/nucleosome-c-sync",runner_environment:"github-hosted",event_name:"push",iat:now-10,exp:now+290};
  assert.equal(allowedPilotClaims(claims,now),true);assert.equal(allowedProgressClaims(claims,now),false);
  for (const change of [{repository_visibility:"public"},{repository_id:"1"},{repository_owner_id:"1"},{event_name:"workflow_dispatch"},{aud:"nucleosome-progress"},{ref:"refs/heads/main"},{workflow_ref:"other"},{exp:now-1}]) assert.equal(allowedPilotClaims({...claims,...change},now),false);
});
