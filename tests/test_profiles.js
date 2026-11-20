const assert=require('node:assert/strict');
const M=require('../profiles.js');
if (!globalThis.crypto) globalThis.crypto=require('node:crypto').webcrypto;
assert.equal(M.label(' @Канал  А '),'@Канал А');
assert.equal(M.normalized('ТЕСТ'),'тест');
assert.throws(()=>M.validateLabel('   '),/Название/);
assert.throws(()=>M.validateLabel('X'.repeat(121)),/Название/);
const p1=M.makeProfile('@КаналА');
const p2=M.makeProfile('@КаналБ',[p1]);
assert.notEqual(p1.id,p2.id);
assert.throws(()=>M.makeProfile('@канала',[p1]),/уже есть/);
assert.equal(M.validateLabel('@канала',[p1],p1.id),'@канала');
assert.deepEqual(M.settings({maxSteps:15,pauseMs:650}),{maxSteps:15,pauseMs:650,maxRemovals:10,chatRef:''});
assert.throws(()=>M.settings({maxSteps:9,pauseMs:650}),/диапазон/);
assert.throws(()=>M.settings({maxSteps:18,pauseMs:349}),/диапазон/);
assert.throws(()=>M.settings({maxSteps:'11foo',pauseMs:650}),/Некорректно/);
assert.throws(()=>M.settings({maxSteps:15.5,pauseMs:650}),/Некорректно/);
assert(M.rowsKey(p1.id)!==M.rowsKey(p2.id));
const rows=M.sanitizeRows([
 {name:'Маша',status:'была давно'},{name:'Маша',status:'была давно'},
 {name:'Саша',status:'был(а) недавно'},
 {name:'Вера',status:'был(а) давно'},
 {name:'=SUM(1)',status:'last seen a long time ago'}]);
assert.deepEqual(rows.map(r=>r.name),['Маша','Вера','=SUM(1)']);
assert(rows.every(x=>x.identityVerified===false));
let old={'channelCleanerV3:last':'@канал-а','channelCleanerV3:%40канал-а':[{name:'Ира',status:'была давно'}], 'channelCleanerV3:%40канал-б':[{name:'Олег',status:'был давно'}]};
const migration=M.migrateV3(old);
assert.equal(migration.migrated,true);
assert.equal(migration.profiles.length,2);
assert.equal(Object.keys(migration.records).length,2);
assert.equal(migration.profiles.reduce((s,x)=>s+x.lastCount,0),2);
const again=M.migrateV3({...old,[M.PREFIX+'profiles']:migration.profiles});
assert.equal(again.migrated,false);
assert.equal(Object.keys(again.records).length,0);
const existing=M.readProfiles([p1,p1,p2,{id:'bad',label:'bad'}]);
assert.equal(existing.length,2);
assert.equal(M.MAX_PROFILES,100);
console.log('Profiles unit PASS: validation, settings, isolation, migration, duplicates');
