import { Prisma } from '@/app/generated/prisma/client';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { parseAmazonShippingEvidence } from './amazon-shipping-evidence';
import type { guardAmazonUploadShipping, resolveShippingApproval } from './amazon-upload-shipping';
import type { uploadProductToEbay } from './ebay-upload';
import type { createOrReuseEbayUploadJob } from './ebay-action-jobs';
import type { queueAmazonShippingHold } from './price-check-auto-hold';
import type { queuePriceCheckAutoResumeForRun } from './price-check-auto-resume';
import type { POST } from '../app/api/upload/route';
import type { DELETE } from '../app/api/upload/shipping-confirmation/route';

type Row = Record<string, unknown>;
type Query = {where?: Row;orderBy?: Row | Row[];select?: Row;take?: number};
const compiled = build({
  stdin: {resolveDir: process.cwd() + '/lib', loader:'ts', contents: fs.readFileSync('lib/ebay-action-jobs.ts','utf8') + '\nexport {processProduct};\nexport {queueAmazonShippingHold} from "./price-check-auto-hold";\nexport {queuePriceCheckAutoResumeForRun} from "./price-check-auto-resume";\nexport {POST as requestUpload} from "../app/api/upload/route";\nexport {DELETE as cancelShippingConfirmation} from "../app/api/upload/shipping-confirmation/route";\nexport {guardAmazonUploadShipping} from "./amazon-upload-shipping";\nexport {uploadProductToEbay} from "./ebay-upload";'},
  bundle:true,platform:'node',format:'cjs',write:false,packages:'external',
  plugins:[{name:'offline-shipping-services',setup(builder){
    builder.onResolve({filter:/^@\/app\/generated\/prisma\/client$/},()=>({path:'client',namespace:'fixture'}));
    const replacements:Record<string,string>={client:'export const Prisma=globalThis.Prisma;',
      'prisma':'export const prisma=globalThis.database;',
      'amazon-scraper':'export const scrapeAmazonPrice=(...args)=>globalThis.scrape(...args);',
      'cache-tags':'export const invalidateProductCaches=()=>{};export const invalidateJobCaches=()=>{};',
      'logger':'export const logger={info(){},warn(){},error(){},debug(){}};export const createRequestLogger=()=>logger;',
      '@/auth':'export const auth=async()=>globalThis.authenticate();',
      'next/server':'export class NextResponse extends Response {static json(value,options){return Response.json(value,options);}}',
      'store-session':'export const getCurrentStoreSession=async()=>({storeId:globalThis.sessionStore()});export const getInternalUserId=async()=>"user";',
      'worker-heartbeat':'export const assertWorkerOnlineForStore=async()=>{};',
      'ebay':`export const getStoreNumber=async()=>{globalThis.beforeStoreNumber();return "1";};export const callEbayAddItem=(...args)=>globalThis.add(...args);export const callEbayReviseItem=(...args)=>globalThis.revise(...args);
        export const callEbayEndItem=async()=>({success:true});export const callEbayReviseInventoryStatus=async()=>({success:true});
        export const createEbayGeneralCampaign=async()=>({});export const createEbayPromotedAds=async()=>({});export const deleteEbayPromotedAds=async()=>({});
        export const getEbayGeneralCampaign=async()=>({});export const getEbayPromotedListingSync=async()=>({});export const getEbayPromotedListingsEligibility=async()=>({});export const updateEbayPromotedAdRates=async()=>({});`,
      'policy-defaults':'export const policyIdsMatch=()=>true;export const resolveProductPolicySelection=async()=>({shippingPolicyId:"shipping",paymentPolicyId:"payment",returnPolicyId:"returns"});',
      'template-resolver':'export const resolveDescriptionTemplate=async()=>"Fixture description";',
      'ebay-required-specifics':'export const validateRequiredItemSpecifics=async()=>({decisions:[],addedItemSpecifics:{},missingItemSpecifics:[],requiredItemSpecifics:[],itemSpecifics:{Brand:"Acme",_PostalCode:"2217",_Country:"AU",_Location:"Kogarah"}});export const buildMissingItemSpecificsResponse=()=>({missingItemSpecifics:[]});',
      'package-data-sync':`export const canonicalizePackageItemSpecifics=value=>value;export const getStoredPackageDimensions=()=>({weightKg:1,lengthCm:10,widthCm:10,heightCm:10});
        export const compareEbayPackageDimensions=()=>({status:"MATCH",differences:[]});export const fetchEbayPackageItem=async()=>({});export const mergeEbayPackageItemSpecifics=()=>({});`,
      'amazon-direct-scraper':'export const scrapeAmazonPackageItemSpecificsDirect=async()=>({});',
      'price-check-result-application':'export class SupersededAmazonObservation extends Error{};export const assertAmazonObservationCurrent=async()=>{};',
      'listing-operations':'export const recordListingOperation=async(input)=>globalThis.operations.push(input);',
      'server-only':'',
    };
    builder.onResolve({filter:/^(server-only|@\/auth|next\/server|(?:@\/lib\/|\.\/)[\w-]+)$/},args=>{
      const key=args.path.replace(/^(?:@\/lib\/|\.\/)/,'');
      return key in replacements ? {path:key,namespace:'fixture'} : undefined;
    });
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:replacements[args.path],loader:'ts',resolveDir:process.cwd()}));
  }}],
}).then(result=>result.outputFiles[0].text);

function matches(row:Row,where:Row={}) : boolean {
  return Object.entries(where).every(([key,value])=>{
    if(key==='OR')return (value as Row[]).some(part=>matches(row,part));
    if(key==='storeId_supplierName')return matches(row,value as Row);
    const actual=row[key];
    if(value && typeof value==='object' && !(value instanceof Date)){
      const condition=value as Row;
      if('path' in condition) return (condition.path as string[]).reduce<unknown>((value,key)=>value&&typeof value==='object'?(value as Row)[key]:undefined,actual)===condition.equals;
      if('gt' in condition)return Number(actual)>Number(condition.gt);
      if('notIn' in condition)return !(condition.notIn as unknown[]).includes(actual);
      if('in' in condition)return (condition.in as unknown[]).includes(actual);
      if('not' in condition)return actual!==condition.not;
      if('has' in condition)return Array.isArray(actual)&&actual.includes(condition.has);
      if('hasSome' in condition)return Array.isArray(actual)&&(condition.hasSome as unknown[]).some(id=>actual.includes(id));
      if('gte' in condition)return Number(actual)>=Number(condition.gte);
    }
    return actual===value;
  });
}
async function fixture(arrivalText:string|null='delivery tomorrow') {
  const product:Row={id:'product',storeId:'store',createdById:'user',asin:'B0TEST1234',amazonPriceTrackingMode:'REGULAR',title:'Fixture laminator',
    fullTitle:'Fixture laminator',description:'Fixture',category:'123',categoryName:'Kitchen',condition:'New',status:'DRAFT',price:125,amazonPrice:96.75,
    quantity:1,ebayItemId:null,images:["https://example.test/image.jpg"],itemSpecifics:{Brand:'Acme',_PostalCode:'2217',_Country:'AU',_Location:'Kogarah'},store:{id:'store'},holdOrigin:null,holdSavedQuantity:null,
    variants:[],paymentPolicyId:'payment',shippingPolicyId:'shipping',returnPolicyId:'returns',amazonAvailability:'IN_STOCK',priceCheckError:null,priceCheckFailureCode:null};
  const settings:Row={storeId:'store',supplierName:'Amazon AU',maxShippingDays:25,scrapePostcode:'2217',minProductQuantity:2,autoHoldOnPriceCheckFailure:false};
  const tables:Record<string,Row[]>={product:[product],supplierSettings:[settings],amazonPriceObservation:[],ebayActionJob:[],variant:[],uploadLog:[],ebayListingAsin:[],priceHistory:[]};
  let id=0;
  const model=(name:string)=>{
    const rows=(query:Query={})=>tables[name].filter(row=>matches(row,query.where)).sort((a,b)=>{
      for(const order of [query.orderBy??{}].flat())for(const [key,direction]of Object.entries(order)){
        const left=a[key],right=b[key];const result=left!<right!?-1:left!>right!?1:0;if(result)return direction==='desc'?-result:result;
      }return 0;
    });
    const project=(row:Row|undefined,query:Query)=>!row?null:query.select?Object.fromEntries(Object.keys(query.select).map(key=>[key,row[key]])):{...row};
    return {
      findFirst:async(query:Query)=>project(rows(query)[0],query),
      findUnique:async(query:Query)=>project(rows(query)[0],query),
      findFirstOrThrow:async(query:{where?:Row})=>{const row=rows(query)[0];assert.ok(row);return row;},
      findMany:async(query:Query={})=>rows(query).slice(0,query.take).map(row=>project(row,query)),
      create:async(query:{data:Row})=>{const row={id:`row-${++id}`,status:'QUEUED',errors:[],metadata:{},completedProductIds:[],processed:0,succeeded:0,failed:0,observedAt:new Date(),createdAt:new Date(),updatedAt:new Date(),startedAt:null,completedAt:null,dismissedAt:null,...query.data};tables[name].push(row);return row;},
      update:async(query:{where:Row;data:Row})=>{const row=rows(query)[0];assert.ok(row);Object.assign(row,query.data);return row;},
      updateMany:async(query:{where:Row;data:Row})=>{const found=rows(query);found.forEach(row=>Object.assign(row,query.data));return {count:found.length};},
      upsert:async(query:{where:Row;create:Row;update:Row})=>{let row=rows(query)[0];if(!row){row={id:`row-${++id}`,...query.create};tables[name].push(row);}else Object.assign(row,query.update);return row;},
    };
  };
  const models=Object.fromEntries(Object.keys(tables).map(name=>[name,model(name)]));
  let serial=Promise.resolve();
  const database={...models,$queryRaw:async()=>[{id:'product'}],async $transaction<T>(operation:(tx:unknown)=>Promise<T>){
    const previous=serial;let release=()=>{};serial=new Promise<void>(resolve=>{release=resolve;});await previous;
    try{return await operation(database);}finally{release();}
  }};
  let scrapes=0,adds=0,revisions=0;
  let authenticated=true, sessionStore="store";
  let beforeStoreNumber:()=>void=()=>{};
  let scrapeOverrides:Row={};
  let currentArrival=arrivalText;
  let failScrape:Error|null=null;
  let reviseSuccess=true, addSuccess=true;
  const operations:Row[]=[];
  const observed=()=>{const at=new Date();return {price:96.75,stockLeft:4,detectedAsin:'B0TEST1234',identityOutcome:'MATCH',buyBoxOutcome:'AVAILABLE',postcodeVerified:true,selectedPriceMode:'REGULAR',observedAt:at,
    priceChoices:{regular:96.75,deal:null},shippingEvidence:parseAmazonShippingEvidence({asin:'B0TEST1234',mode:'REGULAR',postcode:'2217',observedAt:at,source:'fixture',arrivalText:currentArrival,associated:true})};};
  const fixtureModule={exports:{}};
  vm.runInNewContext(await compiled,{module:fixtureModule,exports:fixtureModule.exports,require:createRequire(import.meta.url),process,console,Buffer,URL,URLSearchParams,Date,Intl,Response,Request,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    fetch:()=>{throw Error('Unexpected network call');},globalThis:{database,operations,Prisma,beforeStoreNumber:()=>beforeStoreNumber(),authenticate:()=>authenticated?{user:{id:"user"}}:null,sessionStore:()=>sessionStore,
      scrape:async()=>{scrapes++;if(failScrape)throw failScrape;return {...observed(),...scrapeOverrides};},
      add:async()=>{adds++;return addSuccess?{success:true,itemId:'123456789012'}:{success:false,errorMessage:'Synthetic eBay failure'};},revise:async()=>{revisions++;return {success:reviseSuccess,errorMessage:reviseSuccess?undefined:'Synthetic eBay failure'};}}});
  const api=fixtureModule.exports as {guardAmazonUploadShipping:typeof guardAmazonUploadShipping;uploadProductToEbay:typeof uploadProductToEbay;createOrReuseEbayUploadJob:typeof createOrReuseEbayUploadJob;
    queueAmazonShippingHold:typeof queueAmazonShippingHold;queuePriceCheckAutoResumeForRun:typeof queuePriceCheckAutoResumeForRun;requestUpload:typeof POST;cancelShippingConfirmation:typeof DELETE;getCurrentEbayActionJobs:(storeId:string)=>Promise<Array<{id:string;errors:Array<{shippingConfirmation?:unknown}>}>>;resolveShippingApproval:typeof resolveShippingApproval;processProduct:(job:Row,id:string)=>Promise<{ok:boolean;failure:Row|null}>};
  return {api,product,settings,tables,operations,input:{product:product as unknown as Parameters<typeof guardAmazonUploadShipping>[0]['product'],userId:'user'},counts:()=>({scrapes,adds,revisions}),
    beforeMarketplaceWrite:(callback:()=>void)=>{beforeStoreNumber=callback;},setAuthenticated:(value:boolean)=>{authenticated=value;},setStore:(value:string)=>{sessionStore=value;},setScrapeOverrides:(value:Row)=>{scrapeOverrides=value;},
    setArrival:(text:string|null)=>{currentArrival=text;},setScrapeError:(error:Error)=>{failScrape=error;},setAddSuccess:(value:boolean)=>{addSuccess=value;},setReviseSuccess:(value:boolean)=>{reviseSuccess=value;},
    commit(){const value=observed();const row={id:'committed',productId:'product',storeId:'store',requestedAsin:'B0TEST1234',selectedAsin:'B0TEST1234',verifiedPostcode:'2217',postcodeVerified:true,isSuccessful:true,priceMode:'REGULAR',stockLeft:4,identityOutcome:'MATCH',buyBoxOutcome:'AVAILABLE',observedAt:value.observedAt,shippingEvidence:value.shippingEvidence};tables.amazonPriceObservation.push(row);Object.assign(product,{holdLastObservationId:row.id,lastPriceCheck:row.observedAt,amazonPriceObservations:tables.amazonPriceObservation,_count:{priceHistory:0}});return row;},
  };
}

test('actual uploader publishes within limit and blocks confirmed slow delivery without an eBay write',async()=>{
  for(const [arrival,allowed] of [['delivery tomorrow',true],['delivery in 26 days',false]] as const){
    const f=await fixture(arrival);const result=await f.api.uploadProductToEbay({productId:'product',storeId:'store',userId:'user'});
    assert.equal(result.ok,allowed,JSON.stringify(result.body));assert.equal(f.counts().adds,allowed?1:0);
    assert.equal(f.product.status,allowed?'IMPORTED':'DRAFT');
  }
});
test('unknown delivery stays draft, retries once, and produces a durable per-item challenge',async()=>{
  const f=await fixture(null);const result=await f.api.uploadProductToEbay({productId:'product',storeId:'store',userId:'user'});
  assert.equal(result.status,409);assert.equal(f.counts().scrapes,2);assert.equal(f.counts().adds,0);assert.equal(f.product.status,'DRAFT');
  assert.ok(result.body.shippingConfirmation);assert.equal(f.tables.ebayActionJob.length,1);
  assert.ok(f.tables.ebayActionJob[0].errors);
});
test('approval is bound to one attempt and duplicate approval reuses its job',async()=>{
  const f=await fixture(null);const first=await f.api.guardAmazonUploadShipping(f.input);assert.ok(!first.allowed && first.confirmation);
  const confirmation=first.confirmation;
  const [a,b]=await Promise.all([f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product'],shippingConfirmation:confirmation}),f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product'],shippingConfirmation:confirmation})]);
  assert.equal(a.job.id,b.job.id);
  const job=f.tables.ebayActionJob.find(row=>row.id===a.job.id)!;
  const result=await f.api.processProduct(job,'product');assert.equal(result.ok,true,JSON.stringify(result));assert.equal(f.counts().adds,1);
});
test('an approval cannot override slow delivery or changed context, and technical failures never offer an override',async()=>{
  for(const change of ['slow','postcode','asin','technical'] as const){
    const f=await fixture(null);const initial=await f.api.guardAmazonUploadShipping(f.input);assert.ok(!initial.allowed&&initial.confirmation);
    if(change==='postcode')f.settings.scrapePostcode='2000';if(change==='asin')f.product.asin='B0OTHER123';
    if(change==='postcode'||change==='asin'){
      await assert.rejects(f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product'],shippingConfirmation:initial.confirmation}),/changed/);continue;
    }
    const queued=await f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product'],shippingConfirmation:initial.confirmation});
    if(change==='slow')f.setArrival('delivery in 30 days');else f.setScrapeError(new Error('Synthetic challenge page'));
    const result=await f.api.processProduct(f.tables.ebayActionJob.find(row=>row.id===queued.job.id)!,'product');
    assert.equal(result.ok,false);assert.equal(f.counts().adds,0);assert.equal(f.product.status,'DRAFT');
    assert.equal(result.failure?.shippingConfirmation,undefined);
  }
});
test('shipping hold waits for eBay confirmation, ignores disabled price-failure holds, and rechecks settings',async()=>{
  for(const scenario of ['success','failure','changed-limit'] as const){
    const f=await fixture('delivery in 26 days');Object.assign(f.product,{status:'IMPORTED',ebayItemId:'123456789012'});f.commit();
    if(scenario==='failure')f.setReviseSuccess(false);if(scenario==='changed-limit')f.settings.maxShippingDays=30;
    const result=await f.api.processProduct({id:'hold',storeId:'store',userId:'user',type:'HOLD',metadata:{kind:'amazon-shipping-hold'}},'product');
    assert.equal(f.product.status,scenario==='success'?'ON_HOLD':'IMPORTED');
    assert.equal(f.counts().revisions,scenario==='changed-limit'?0:1);assert.equal(result.ok,scenario!=='failure');
    if(scenario==='success')assert.equal(f.product.holdOrigin,'AMAZON_SHIPPING_DELAY');
  }
});
test('shipping recovery requires fresh arrival and successful prices, preserves manual holds and confirms quantity one',async()=>{
  for(const scenario of ['success','unknown','pending-price','manual','stale'] as const){
    const f=await fixture(scenario==='unknown'?null:'delivery tomorrow');Object.assign(f.product,{status:'ON_HOLD',ebayItemId:'123456789012',quantity:0,holdOrigin:scenario==='manual'?'MANUAL':'AMAZON_SHIPPING_DELAY'});
    const row=f.commit();if(scenario==='pending-price')f.product._count={priceHistory:1};
    if(scenario==='stale')row.shippingEvidence={...row.shippingEvidence,observedAt:new Date(Date.now()-16*60_000).toISOString()};
    await f.api.processProduct({id:'resume',storeId:'store',userId:'user',type:'RESUME',metadata:{kind:'price-check-auto-resume'}},'product');
    assert.equal(f.product.status,scenario==='success'?'IMPORTED':'ON_HOLD');assert.equal(f.counts().revisions,scenario==='success'?1:0);
    if(scenario==='success')assert.equal(f.product.quantity,1);
  }
});


test('authenticated API validates approval context and cancellation durably', async()=>{
  const f=await fixture(null);const initial=await f.api.guardAmazonUploadShipping(f.input);assert.ok(!initial.allowed&&initial.confirmation);
  const request=()=>new Request('http://fixture.test/api/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productId:'product',background:true,shippingConfirmation:initial.confirmation})});
  f.setAuthenticated(false);assert.equal((await f.api.requestUpload(request())).status,401);
  f.setAuthenticated(true);f.setStore('another-store');assert.equal((await f.api.requestUpload(request())).status,404);
  f.setStore('store');f.settings.maxShippingDays=26;assert.equal((await f.api.requestUpload(request())).status,409);
  f.settings.maxShippingDays=25;
  const cancel=()=>new Request('http://fixture.test/api/upload/shipping-confirmation',{method:'DELETE',body:JSON.stringify({shippingConfirmation:initial.confirmation})});
  assert.equal((await f.api.cancelShippingConfirmation(cancel())).status,200);
  assert.equal((await f.api.cancelShippingConfirmation(cancel())).status,409);
  assert.equal((await f.api.requestUpload(request())).status,409);
  const jobs=await f.api.getCurrentEbayActionJobs('store');assert.ok(jobs.every(job=>job.errors.every(error=>!error.shippingConfirmation)));
});

test('a retry starts a new attempt without inheriting approval or retaining the old prompt',async()=>{
  const f=await fixture(null);const initial=await f.api.guardAmazonUploadShipping(f.input);assert.ok(!initial.allowed&&initial.confirmation);
  const retry=await f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product']});
  const current=f.tables.ebayActionJob.find(job=>job.id===retry.job.id)!;
  assert.equal(JSON.stringify(current.metadata),"{}");
  const result=await f.api.processProduct(current,'product');assert.ok(!result.ok&&result.failure?.shippingConfirmation);
  assert.ok((result.failure.shippingConfirmation as Row).nonce!==initial.confirmation.nonce);
  const jobs=await f.api.getCurrentEbayActionJobs('store');assert.ok(!jobs.find(job=>job.id===initial.confirmation.sourceJobId)?.errors.some(error=>error.shippingConfirmation));
});

test('cached shipping is reused only for a current matching verified offer',async()=>{
  for(const scenario of ['fresh','stale','wrong-postcode','legacy','failed'] as const){
    const f=await fixture();const row=f.commit();Object.assign(row,{eligibleOffer:true,price:96.75});
    if(scenario==='stale'){row.observedAt=new Date(Date.now()-16*60_000);row.shippingEvidence={...row.shippingEvidence,observedAt:row.observedAt.toISOString()};}
    if(scenario==='wrong-postcode')row.verifiedPostcode='2000';
    if(scenario==='legacy')Object.assign(row,{shippingEvidence:null});
    if(scenario==='failed')Object.assign(row,{isSuccessful:false,identityOutcome:'MISMATCH'});
    const result=await f.api.guardAmazonUploadShipping(f.input);assert.equal(result.allowed,true);assert.equal(f.counts().scrapes,scenario==='fresh'?0:1);
  }
});

test('approval cannot bypass ASIN, postcode, buy box, variant, or exact price mode verification',async()=>{
  for(const invalid of [{stockLeft:0},{detectedAsin:'B0OTHER123'},{postcodeVerified:false},{buyBoxOutcome:'UNAVAILABLE'},{variantSelectionFailed:true,price:null},{selectedPriceMode:'DEAL'}]){
    const f=await fixture(null);const first=await f.api.guardAmazonUploadShipping(f.input);assert.ok(!first.allowed&&first.confirmation);
    const queued=await f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product'],shippingConfirmation:first.confirmation});
    f.setScrapeOverrides(invalid);
    const result=await f.api.processProduct(f.tables.ebayActionJob.find(row=>row.id===queued.job.id)!,'product');
    assert.equal(result.ok,false);assert.equal(f.counts().adds,0);assert.equal(result.failure?.shippingConfirmation,undefined);
  }
});


test('pending shipping confirmation survives more than five later completed jobs',async()=>{
  const f=await fixture(null);const result=await f.api.guardAmazonUploadShipping(f.input);assert.ok(!result.allowed&&result.confirmation);
  const source=f.tables.ebayActionJob[0];source.createdAt=new Date(Date.now()-100_000);
  for(let index=0;index<6;index++)f.tables.ebayActionJob.push({...source,id:'unrelated-'+index,productIds:['other-'+index],createdAt:new Date(Date.now()+index),metadata:{},errors:[]});
  const jobs=await f.api.getCurrentEbayActionJobs('store');
  assert.ok(jobs.find(job=>job.id===source.id)?.errors.some(error=>error.shippingConfirmation));
});

test('automatic recovery query retains ASIN and current evidence and deduplicates queued actions',async()=>{
  const f=await fixture();Object.assign(f.product,{status:'ON_HOLD',holdOrigin:'AMAZON_SHIPPING_DELAY',ebayItemId:'123456789012',amazonStockLeft:4});f.commit();
  const input={storeId:'store',userId:'user',productIds:['product'],checkedSince:f.product.lastPriceCheck as Date};
  const first=await f.api.queuePriceCheckAutoResumeForRun(input);assert.equal(first.queued,1);
  const second=await f.api.queuePriceCheckAutoResumeForRun(input);assert.equal(second.queued,0);
  assert.equal(f.tables.ebayActionJob.length,1);
});


test('mixed upload batches continue after one item needs shipping confirmation',async()=>{
  const f=await fixture(null);const other:Row={...f.product,id:'second'};f.tables.product.push(other);
  const queued=await f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product','second']});
  const job=f.tables.ebayActionJob.find(row=>row.id===queued.job.id)!;
  const unknown=await f.api.processProduct(job,'product');assert.ok(!unknown.ok&&unknown.failure?.shippingConfirmation);
  f.setArrival('delivery tomorrow');const verified=await f.api.processProduct(job,'second');assert.equal(verified.ok,true);
  assert.equal(f.product.status,'DRAFT');assert.equal(other.status,'IMPORTED');assert.equal(f.counts().adds,1);
});

test('eBay upload and recovery failures never report successful publication or restoration',async()=>{
  const upload=await fixture();upload.setAddSuccess(false);
  const result=await upload.api.uploadProductToEbay({productId:'product',storeId:'store',userId:'user'});
  assert.equal(result.ok,false);assert.notEqual(upload.product.status,'IMPORTED');assert.equal(upload.product.ebayItemId,null);
  const resume=await fixture();Object.assign(resume.product,{status:'ON_HOLD',holdOrigin:'AMAZON_SHIPPING_DELAY',ebayItemId:'123456789012',quantity:0});resume.commit();resume.setReviseSuccess(false);
  const recovered=await resume.api.processProduct({id:'resume',storeId:'store',userId:'user',type:'RESUME',metadata:{kind:'price-check-auto-resume'}},'product');
  assert.equal(recovered.ok,false);assert.equal(resume.product.status,'ON_HOLD');assert.equal(resume.product.quantity,0);
});


test('final recovery validation detects manual holds, pending repricing and changed limits during preparation',async()=>{
  for(const change of ['manual','price','limit'] as const){
    const f=await fixture('delivery in 10 days');Object.assign(f.product,{status:'ON_HOLD',holdOrigin:'AMAZON_SHIPPING_DELAY',ebayItemId:'123456789012',quantity:0});f.commit();
    f.beforeMarketplaceWrite(()=>{if(change==='manual')f.product.holdOrigin='MANUAL';if(change==='price')f.product._count={priceHistory:1};if(change==='limit')f.settings.maxShippingDays=5;});
    await f.api.processProduct({id:'resume',storeId:'store',userId:'user',type:'RESUME',metadata:{kind:'price-check-auto-resume'}},'product');
    assert.equal(f.counts().revisions,0);assert.equal(f.product.status,'ON_HOLD');
  }
});


test('concurrent shipping queues create one hold and leave status unchanged until eBay confirms',async()=>{
  const f=await fixture('delivery in 26 days');Object.assign(f.product,{status:'IMPORTED',ebayItemId:'123456789012'});f.commit();
  const results=await Promise.all([f.api.queueAmazonShippingHold('store','product'),f.api.queueAmazonShippingHold('store','product')]);
  assert.equal(results.filter(Boolean).length,1);assert.equal(f.tables.ebayActionJob.length,1);assert.equal(f.product.status,'IMPORTED');
});

test('a superseded committed observation prevents a delayed shipping hold',async()=>{
  const f=await fixture('delivery in 26 days');Object.assign(f.product,{status:'IMPORTED',ebayItemId:'123456789012'});const original=f.commit();
  f.beforeMarketplaceWrite(()=>{const next={...original,id:'newer'};f.tables.amazonPriceObservation.push(next);f.product.holdLastObservationId=next.id;});
  await f.api.processProduct({id:'hold',storeId:'store',userId:'user',type:'HOLD',metadata:{kind:'amazon-shipping-hold'}},'product');
  assert.equal(f.counts().revisions,0);assert.equal(f.product.status,'IMPORTED');
});

test('conflicting arrival stays unverified for uploads, holds and automatic recovery', async () => {
  const upload = await fixture('delivery in 2 days or 6 weeks');
  const blocked = await upload.api.uploadProductToEbay({ productId: 'product', storeId: 'store', userId: 'user' });
  assert.equal(blocked.status, 409);
  assert.ok(blocked.body.shippingConfirmation);
  assert.equal(upload.counts().adds, 0);
  assert.equal(upload.product.status, 'DRAFT');
  const existing = await fixture('delivery in 2 days or 6 weeks');
  Object.assign(existing.product, { status: 'IMPORTED', ebayItemId: '123456789012' });
  existing.commit();
  assert.equal(await existing.api.queueAmazonShippingHold('store', 'product'), false);
  Object.assign(existing.product, { status: 'ON_HOLD', holdOrigin: 'AMAZON_SHIPPING_DELAY', quantity: 0 });
  await existing.api.processProduct({ id: 'resume', storeId: 'store', userId: 'user', type: 'RESUME', metadata: { kind: 'price-check-auto-resume' } }, 'product');
  assert.equal(existing.counts().revisions, 0);
  assert.equal(existing.product.status, 'ON_HOLD');
});
