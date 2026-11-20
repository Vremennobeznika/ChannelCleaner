const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Policy=require('../scanner.js');
const Profiles=require('../profiles.js');
assert.equal(Profiles.validateChatRef('@mychannel'),'@mychannel');
assert.equal(Profiles.validateChatRef('-10012345678901'),'-10012345678901');
for(const invalid of ['channel','-100','@bad name','@bad','@<>','-100x'])assert.throws(()=>Profiles.validateChatRef(invalid));
assert.equal(Profiles.settings({chatRef:'@mychannel',maxRemovals:1}).maxRemovals,1);
assert.throws(()=>Profiles.settings({maxRemovals:51}));
assert.equal(Policy.canRemove({userId:'1234567',status:'был(а) давно',capturedAt:new Date().toISOString()}),true);
assert.equal(Policy.canRemove({userId:'',status:'был давно',capturedAt:new Date().toISOString()}),false);
assert.equal(Policy.canRemove({userId:'1234567',status:'был недавно',capturedAt:new Date().toISOString()}),false);
assert.equal(Policy.canRemove({userId:'1234567',status:'был давно',capturedAt:'2025-11-20T00:00:00Z'}),false);
assert.equal(Policy.extractUserId({querySelectorAll:()=>[],getAttribute:k=>k==='data-peer-id'?'1234567':null}),'1234567');
assert.equal(Policy.extractUserId({querySelectorAll:()=>[{getAttribute:k=>k==='data-user-id'?'2345678':null}],getAttribute:k=>k==='data-peer-id'?'1234567':null}),'');
const token='123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd';
async function simulate(message, statuses=['member','left'], altered={}) {
  const listeners=[]; const methods=[]; let memberIndex=0;
  const chrome={runtime:{id:'the-extension',onMessage:{addListener:f=>listeners.push(f)}},storage:{local:{get:async()=>({channelCleanerSecrets:{token,owner:'123456789'}})}}};
  const mockFetch=async(url,opt)=>{
    const method=url.split('/').pop();methods.push(method);
    const body=JSON.parse(opt.body);
    let result;
    if(method==='getChat')result={id:-10012345678901,title:'Канал',type:altered.chatType||'channel'};
    else if(method==='getMe')result={id:99887766,is_bot:true};
    else if(method==='getChatMember'){
      result=(body.user_id===99887766 ? {status:'administrator',can_restrict_members:altered.canBan!==false} : {status:statuses[Math.min(memberIndex++,statuses.length-1)]});
    } else if(method==='unbanChatMember')result=true;
    else throw Error('Unexpected method '+method);
    return {ok:true,status:200,json:async()=>({ok:true,result})};
  };
  vm.runInNewContext(fs.readFileSync(__dirname+'/../background.js','utf8'),{chrome,fetch:mockFetch,URL,FormData,Blob,console,AbortController, setTimeout, clearTimeout});
  const sender={id:'the-extension',tab:{url:'https://web.telegram.org/k/'}};
  return await new Promise(resolve=>{
    const handled=listeners.at(-1)(message,{...sender,...altered.sender},res=>resolve({res,methods}));
    if(!handled) resolve({res:null,methods});
  });
}
(async()=>{
  let a=await simulate({type:'CHANNEL_CLEANER_CHECK_CHANNEL',chatRef:'@mychannel'});
  assert.equal(a.res.ok,true);assert.equal(a.res.title,'Канал');assert(!a.methods.includes('unbanChatMember'));
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'123456789'});
  assert.equal(a.res.removed,true);assert.deepEqual(a.methods,['getChat','getMe','getChatMember','getChatMember','unbanChatMember','getChatMember']);
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'123456789'},['administrator']);
  assert.equal(a.res.removed,false);assert(!a.methods.includes('unbanChatMember'));
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'123456789'},['left']);
  assert.equal(a.res.removed,false);assert(!a.methods.includes('unbanChatMember'));
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'123456789'},['member','member']);
  assert.equal(a.res.ok,false);assert(a.res.error.includes('не подтверждено'));
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'123456789'},['member','left'],{canBan:false});
  assert.equal(a.res.ok,false);assert(!a.methods.includes('unbanChatMember'));
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'123456789'},['member','left'],{chatType:'supergroup'});
  assert.equal(a.res.ok,false);assert(!a.methods.includes('unbanChatMember'));
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'invalid'});
  assert.equal(a.res.ok,false);assert(!a.methods.includes('unbanChatMember'));
  a=await simulate({type:'CHANNEL_CLEANER_REMOVE_MEMBER',chatRef:'@mychannel',userId:'123456789'},['member','left'],{sender:{tab:{url:'https://evil.example/'}}});
  assert.equal(a.res.ok,false);assert(!a.methods.includes('unbanChatMember'));
  console.log('Removal worker mock PASS: permissions, channel, member, id, successful verified removal, duplicate, wrong sender, unconfirmed outcome');
})().catch(e=>{console.error(e);process.exitCode=1;});
