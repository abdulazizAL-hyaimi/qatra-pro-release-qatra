const fs=require('fs');
const path=require('path');
const vm=require('vm');

const root=path.resolve(__dirname,'..');
const registryFile=path.join(root,'app/src/main/assets/qatra/assets/staff_registry.js');
const collectorFile=path.join(root,'app/src/main/assets/qatra/assets/collector.js');
const managerCollectorsFile=path.join(root,'app/src/main/assets/qatra/assets/manager_collectors.js');
const readerFile=path.join(root,'app/src/main/assets/qatra/assets/reader.js');
const managerReaderFile=path.join(root,'app/src/main/assets/qatra/assets/manager_reader.js');
const cashierFile=path.join(root,'app/src/main/assets/qatra/assets/cashier.js');
const managerCashboxFile=path.join(root,'app/src/main/assets/qatra/assets/manager_cashbox.js');
const mainActivityFile=path.join(root,'app/src/main/java/com/qatra/pro/MainActivity.java');
const namespacePolicyFile=path.join(root,'app/src/main/java/com/qatra/pro/QatraNamespacePolicy.java');

function assert(value,message){if(!value)throw new Error(message);console.log(`OK  ${message}`)}
const clone=value=>JSON.parse(JSON.stringify(value));
const memory=new Map();
const context={
  console,
  Date,
  Math,
  JSON,
  Set,
  Map,
  window:null,
  QatraStore:{
    load(namespace,fallbackFactory){
      if(memory.has(namespace))return clone(memory.get(namespace));
      return clone(typeof fallbackFactory==='function'?fallbackFactory():fallbackFactory||{});
    },
    save(namespace,value){memory.set(namespace,clone(value));return true;}
  }
};
context.window=context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(registryFile,'utf8'),context,{filename:registryFile});

function addCollector(name,username){
  const state=context.QatraStaff.load();
  const code=context.QatraStaff.generateCode(username);
  const user=context.QatraStaff.validate({name,username,role:'COLLECTOR',code,active:true,permissions:context.QatraStaff.defaults('COLLECTOR')});
  state.users.push(user);
  context.QatraStaff.save(state);
  return user;
}

const abdulrahman=addCollector('عبد الرحمن','abdulrahman');
const ali=addCollector('علي','ali');
const abdullah=addCollector('عبد الله','abdullah');
assert(abdulrahman.code==='AB','first collector receives a two-letter code from the username');
assert(ali.code==='AL','second collector receives its own two-letter code');
assert(abdullah.code==='AD','colliding initials advance to another unique pair');
assert(new Set(context.QatraStaff.all().map(user=>user.code)).size===3,'collector codes are unique');

let duplicateRejected=false;
try{
  context.QatraStaff.validate({name:'محصل آخر',username:'another.collector',role:'COLLECTOR',code:'AL',permissions:['CREATE_RECEIPTS']});
}catch(error){duplicateRejected=/رمز الموظف/.test(error.message)}
assert(duplicateRejected,'a duplicate two-letter code is rejected');

const state=context.QatraStaff.load();
const stopped=state.users.find(user=>user.id===ali.id);
stopped.active=false;
context.QatraStaff.save(state);
assert(!context.QatraStaff.activeByRole('COLLECTOR').some(user=>user.id===ali.id),'disabled collectors cannot receive new assignments');

const collector=fs.readFileSync(collectorFile,'utf8');
const managerCollectors=fs.readFileSync(managerCollectorsFile,'utf8');
const reader=fs.readFileSync(readerFile,'utf8');
const managerReader=fs.readFileSync(managerReaderFile,'utf8');
const cashier=fs.readFileSync(cashierFile,'utf8');
const managerCashbox=fs.readFileSync(managerCashboxFile,'utf8');
const mainActivity=fs.readFileSync(mainActivityFile,'utf8');
const namespacePolicy=fs.readFileSync(namespacePolicyFile,'utf8');
assert(collector.includes("const prefix=`${collectorCode()}-${date}-`")&&collector.includes("padStart(4,'0')"),'collector receipts use CODE-YYYYMMDD-SEQUENCE numbering');
assert(collector.includes("hasPermission('CREATE_RECEIPTS')")&&collector.includes("hasPermission('EXPORT_COLLECTIONS')"),'collector actions enforce assignment permissions');
assert(collector.includes("assignmentId()!==String(data.meta.assignmentId)&&pending.length"),'collector cannot replace a task while receipts are pending delivery');
assert(collector.includes("sessionUsername()!==String(data.meta.collectorUsername).toLowerCase()")&&collector.includes('identityMismatch'),'collector task is bound to the native login username');
assert(managerCollectors.includes('issuedAssignments.find')&&managerCollectors.includes('allowedSubscribers.has')&&managerCollectors.includes('validReceipt'),'admin verifies collector, assignment, subscriber and receipt prefix');
assert(reader.includes("hasPermission('CAPTURE_READINGS')")&&reader.includes("hasPermission('EXPORT_READINGS')"),'reader actions enforce assignment permissions');
assert(reader.includes("assignmentId()!==String(d.meta.assignmentId)&&pending.length"),'reader cannot replace a task while readings are pending delivery');
assert(reader.includes("sessionUsername()!==String(d.meta.readerUsername).toLowerCase()")&&reader.includes('identityMismatch'),'reader task is bound to the native login username');
assert(managerReader.includes('issuedAssignments.find')&&managerReader.includes('allowed.has(raw.subscriberId)'),'admin accepts readings only from an issued reader assignment');
assert(managerCashbox.includes("activeByRole('CASHIER')")&&managerCashbox.includes('cashboxIssuedSetups')&&managerCashbox.includes('verifyCashierPackage'),'cashbox setup and returned batches are bound to an issued cashier identity');
assert(managerCollectors.includes('periodClosed')&&managerReader.includes('Period-close guard')&&managerCashbox.includes('Accounting period guard'),'closed periods reject collector, reader and cashier imports');
assert(cashier.includes("sessionUsername()!==String(s.cashierUsername).toLowerCase()")&&cashier.includes('identityMismatch'),'cashier setup is bound to the native login username');
assert(cashier.includes("hasPermission('DIRECT_COLLECTION')")&&cashier.includes("hasPermission('EXPORT_CASHBOX')"),'cashier actions enforce assigned permissions');
assert(mainActivity.includes('manager_users.html')&&mainActivity.includes('QatraNamespacePolicy.requireNamespace(APP_ROLE, namespace)')&&namespacePolicy.includes('admin.staff')&&namespacePolicy.includes('admin.reader.config')&&namespacePolicy.includes('ENTERPRISE_CORE'),'native bridge and central policy allow ADMIN operational and enterprise namespaces');
assert(mainActivity.includes('out.put("username", sessionUsername)'),'native session exposes only the authenticated username to role pages');
assert(mainActivity.includes('MediaStore.Downloads.RELATIVE_PATH')&&mainActivity.includes('Downloads/" + EXPORT_ROOT'),'Android 10+ exports use the automatic QatraPro Downloads workspace');

console.log('\nRole-management runtime smoke test passed.');
