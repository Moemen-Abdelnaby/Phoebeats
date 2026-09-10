const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync('src/services/nickname.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function load(window) {const exports={}; vm.runInNewContext(source,{exports,window,Event});return exports;}
function fixture(value) {
  const entries = new Map(value === undefined ? [] : [['pb_jamName',value]]);
  const window = new EventTarget();
  window.localStorage = {getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)};
  return {window,entries,profile:load(window)};
}
test('saved nickname survives reload and existing Jam names are reused',()=>{
  const f=fixture(JSON.stringify('Luna'));
  assert.equal(f.profile.readNickname(),'Luna');
  f.profile.saveNickname('  Moon  ');
  assert.equal(load(f.window).readNickname(),'Moon');
});
test('nickname listeners refresh immediately and after another window changes storage',()=>{
  const f=fixture();let updates=0;
  const unsubscribe=f.profile.subscribeNickname(()=>updates++);
  f.profile.saveNickname('Moon');assert.equal(updates,1);
  const event=new Event('storage');event.key='pb_jamName';f.window.dispatchEvent(event);assert.equal(updates,2);
  unsubscribe();f.profile.saveNickname('Luna');assert.equal(updates,2);
});
test('invalid data and failed writes never silently replace the saved nickname',()=>{
  for(const value of ['not json','null','{}','42',JSON.stringify('x'.repeat(41))]) assert.equal(fixture(value).profile.readNickname(),'');
  const f=fixture(JSON.stringify('Moon'));
  for(const value of ['', '  ', 'na\nme', 'x'.repeat(41)]) assert.throws(()=>f.profile.saveNickname(value));
  assert.equal(f.profile.readNickname(),'Moon');
  f.window.localStorage.setItem=()=>{throw Error('Storage blocked');};
  assert.throws(()=>f.profile.saveNickname('Luna'),/could not be saved/);
  assert.equal(f.profile.readNickname(),'Moon');
});
