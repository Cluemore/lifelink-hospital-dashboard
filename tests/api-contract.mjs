import assert from 'node:assert/strict';
import {createServer} from 'vite';
const store=new Map();globalThis.window={sessionStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}};
const requests=[];globalThis.fetch=async(url,options)=>{requests.push({url,...options});return new Response(JSON.stringify(url.endsWith('/login')?{access_token:'test-token',hospital:{id:'HSP-001'}}:{hospitalId:'HSP-001',status:'PENDING_APPROVAL'}),{headers:{'Content-Type':'application/json'}});};
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {apiProviders:p}=await server.ssrLoadModule('/src/providers/api/apiProviders.ts');
 await p.auth.login('demo@example.test','fictional-test');
 for (const [method,args,verb,suffix] of [
 ['getResources',['HSP-001'],'GET','/hospital/resources'],
 ['updateBeds',['HSP-001',{general:{total:1,occupied:0}}],'PATCH','/hospital/resources'],
 ['createDoctor',['HSP-001',{name:'Test'}],'POST','/hospital/resources/doctors'],
 ['updateDoctor',['HSP-001','id/1',{name:'Updated'}],'PATCH','/hospital/resources/doctors/id%2F1'],
 ['deleteDoctor',['HSP-001','id/1'],'DELETE','/hospital/resources/doctors/id%2F1'],
 ['createAmbulance',['HSP-001',{vehicleNumber:'TEST'}],'POST','/hospital/resources/ambulances'],
 ['updateAmbulance',['HSP-001','id/1',{}],'PATCH','/hospital/resources/ambulances/id%2F1'],
 ['deleteAmbulance',['HSP-001','id/1'],'DELETE','/hospital/resources/ambulances/id%2F1']]) {
  await p.resource[method](...args);const r=requests.at(-1);assert.equal(r.method??'GET',verb);assert(r.url.endsWith(suffix));assert.equal(r.headers.Authorization,'Bearer test-token');assert(!r.url.includes('HSP-001'));
 }
 await p.auth.register({hospitalName:'Test'});assert(requests.at(-1).url.endsWith('/auth/hospital/register'));
 console.log('PASS: API registration and eight resource operations, verbs, encoded IDs, token header, principal-scoped paths. Fetch mocked; no live backend tested.');
} finally {await server.close();}
