const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
async function run(sec, message, sender) {
  let listeners=[], sent={}, response, resolve;
  const done=new Promise(r=>resolve=r);
  const chrome={
    runtime:{onMessage:{addListener(fn){listeners.push(fn);}}},
    storage:{local:{get:async()=>({channelCleanerSecrets:sec})}}
  };
  const mockFetch=async(url,opts)=>{
    sent={url,opts};
    return {ok:true,json:async()=>({ok:true,result:{message_id:123}})};
  };
  vm.runInNewContext(fs.readFileSync(__dirname+'/../background.js','utf8'), {chrome,fetch:mockFetch,URL,FormData,Blob,console});
  const v=listeners[0](message,sender,x=>{response=x;resolve();});
  assert.equal(v,true);
  await done;
  return {response,sent};
}
(async()=>{
  let valid={token:'123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd',owner:'123456789'};
  let r=await run(valid,{type:'CHANNEL_CLEANER_SEND_REPORT',channel:'@канал',rows:[{name:'Мария',status:'была давно',capturedAt:'2026-11-20'}]},{tab:{url:'https://web.telegram.org/k/'}});
  assert.equal(r.response.ok,true);
  assert.match(r.sent.url,/^https:\/\/api.telegram.org\/bot/);
  assert.equal(r.sent.opts.body.get('chat_id'),'123456789');
  assert.equal(r.sent.opts.body.get('document').name,'ChannelCleaner_candidates.csv');
  r=await run(valid,{type:'CHANNEL_CLEANER_SEND_REPORT',channel:'@канал',rows:[{name:'x',status:'был давно'}]},{tab:{url:'https://evil-telegram.org/k/'}});
  assert.equal(r.response.ok,false);
  assert.equal(Object.keys(r.sent).length,0);
  r=await run({token:'bad',owner:'123456789'},{type:'CHANNEL_CLEANER_SEND_REPORT',channel:'@канал',rows:[{name:'x'}]},{tab:{url:'https://web.telegram.org/k/'}});
  assert.equal(r.response.ok,false);
  assert.equal(Object.keys(r.sent).length,0);
  r=await run(valid,{type:'CHANNEL_CLEANER_SEND_REPORT',channel:'@канал',rows:[]},{tab:{url:'https://web.telegram.org/k/'}});
  assert.equal(r.response.ok,false);
  console.log('Background send: 10/10 assertions OK');
})().catch(e=>{console.error(e);process.exitCode=1});
