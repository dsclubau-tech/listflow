import { XMLParser } from "fast-xml-parser";
import { Prisma } from '@/app/generated/prisma/client';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { getProductShippingPresentation, type ShippingDisplayObservation } from "./amazon-shipping-display";
import { parseAmazonShippingEvidence } from './amazon-shipping-evidence';
import { extractAmazonShippingEvidenceFromHtml } from './amazon-shipping-extraction';
import { extractAmazonPriceSnapshot } from './amazon-price-snapshot';
import { normalShippingOffer, accordionShippingOffers, newAndUsedShippingOffers } from '../tests/fixtures/amazon-shipping-offers';
import type { guardAmazonUploadShipping, resolveShippingApproval } from './amazon-upload-shipping';
import type { uploadProductToEbay } from './ebay-upload';
import type { createOrReuseEbayUploadJob } from './ebay-action-jobs';
import type { queueAmazonShippingHold } from './price-check-auto-hold';
import type { queuePriceCheckAutoResumeForRun } from './price-check-auto-resume';
import type { POST } from '../app/api/upload/route';
import type { DELETE } from '../app/api/upload/shipping-confirmation/route';

type Row = Record<string, unknown>;
type Query = {where?: Row;orderBy?: Row | Row[];select?: Row;take?: number;include?:Row};
const compiled = build({
  stdin: {resolveDir: process.cwd() + '/lib', loader:'ts', contents: fs.readFileSync('lib/ebay-action-jobs.ts','utf8') + '\nexport {processProduct,markProgress};\nexport {POST as approveSingle} from "../app/api/price-check/apply/route";\nexport {POST as approveBulk} from "../app/api/price-check/bulk-apply/route";\nexport {POST as retryBulk} from "../app/api/products/bulk-edit/jobs/[id]/retry/route";\nexport {queueAmazonShippingHold} from "./price-check-auto-hold";\nexport {queuePriceCheckAutoResumeForRun} from "./price-check-auto-resume";\nexport {POST as requestUpload} from "../app/api/upload/route";\nexport {DELETE as cancelShippingConfirmation} from "../app/api/upload/shipping-confirmation/route";\nexport {guardAmazonUploadShipping} from "./amazon-upload-shipping";\nexport {uploadProductToEbay} from "./ebay-upload";'},
  bundle:true,platform:'node',format:'cjs',write:false,packages:'external',
  plugins:[{name:'offline-shipping-services',setup(builder){
    builder.onResolve({filter:/^@\/app\/generated\/prisma\/client$/},()=>({path:'client',namespace:'fixture'}));
    const replacements:Record<string,string>={client:'export const Prisma=globalThis.Prisma;',
      'prisma':'export const prisma=globalThis.database;',
      'amazon-scraper':'export const scrapeAmazonPrice=(...args)=>globalThis.scrape(...args);',
      'cache-tags':'export const invalidateProductCaches=()=>{};export const invalidateJobCaches=()=>{};export const invalidatePriceCaches=()=>{};',
      'logger':'export const logger={info(){},warn(){},error(){},debug(){}};export const createRequestLogger=()=>logger;',
      '@/auth':'export const auth=async()=>globalThis.authenticate();',
      'next/server':'export class NextResponse extends Response {static json(value,options){return Response.json(value,options);}}',
      'store-session':'export const getCurrentStoreSession=async()=>({storeId:globalThis.sessionStore()});export const getInternalUserId=async()=>"user";',
      'worker-heartbeat':'export const assertWorkerOnlineForStore=async()=>{};export const assertWorkerSupportsDurableBulkEdit=async()=>{};',
      'ebay':`export const getStoreNumber=async()=>{globalThis.beforeStoreNumber();return "1";};export const callEbayAddItem=(...args)=>globalThis.add(...args);export const callEbayReviseItem=(...args)=>globalThis.revise(...args);
        export const callEbayEndItem=async()=>({success:true});export const callEbayReviseInventoryStatus=(xml)=>globalThis.inventoryWrite(xml);export const callEbayGetItem=async()=>globalThis.inventoryRead();
        export const createEbayGeneralCampaign=async()=>({});export const createEbayPromotedAds=async()=>({});export const deleteEbayPromotedAds=async()=>({});
        export const getEbayGeneralCampaign=async()=>({});export const getEbayPromotedListingSync=async()=>({});export const getEbayPromotedListingsEligibility=async()=>({});export const updateEbayPromotedAdRates=async()=>({});`,
      'policy-defaults':'export const policyIdsMatch=()=>true;export const resolveProductPolicySelection=async()=>({shippingPolicyId:"shipping",paymentPolicyId:"payment",returnPolicyId:"returns"});',
      'keyword-filter':'export const applyKeywordFilter=async(title,description)=>({title,description,removedKeywords:[]});',
      'ebay-media':'export const createEbayImageFromUrl=async()=>({url:"https://i.ebayimg.com/images/g/fixture/s-l1600.jpg"});',
      'template-resolver':'export const resolveDescriptionTemplate=async()=>"Fixture description";',
      'ebay-required-specifics':'export const validateRequiredItemSpecifics=async()=>({decisions:[],addedItemSpecifics:{},missingItemSpecifics:[],requiredItemSpecifics:[],itemSpecifics:{Brand:"Acme",_PostalCode:"2217",_Country:"AU",_Location:"Kogarah"}});export const buildMissingItemSpecificsResponse=()=>({missingItemSpecifics:[]});',
      'package-data-sync':`export const canonicalizePackageItemSpecifics=value=>value;export const getStoredPackageDimensions=()=>({weightKg:1,lengthCm:10,widthCm:10,heightCm:10});
        export const compareEbayPackageDimensions=()=>({status:"MATCH",differences:[]});export const fetchEbayPackageItem=async()=>({});export const mergeEbayPackageItemSpecifics=()=>({});`,
      'amazon-direct-scraper':'export const scrapeAmazonPackageItemSpecificsDirect=async()=>({});',
      'price-check-result-application':'export class PriceCheckResultDeferred extends Error{};export class SupersededAmazonObservation extends Error{};export const assertAmazonObservationCurrent=async()=>{};export const acquirePriceCheckResultLease=async()=>({assertOwnership:async()=>{},release:async()=>{}});export const runObservedPriceWrite=async(input,write)=>write();',
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
    if(key==='storeId_supplierName'||key==='jobId_productId')return matches(row,value as Row);
    if(key==='product')return matches(row.product as Row??{},value as Row);
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
  const tables:Record<string,Row[]>={product:[product],supplierSettings:[settings],amazonPriceObservation:[],ebayActionJob:[],variant:[],uploadLog:[],ebayListingAsin:[],priceHistory:[],listingOperation:[],bulkEditJobItem:[]};
  let id=0;
  const applyMockData=(row:Row,data:Row)=>{for(const [key,value] of Object.entries(data)){
    if(value&&typeof value==="object"&&"set" in value)row[key]=(value as Row).set;
    else if(value&&typeof value==="object"&&"increment" in value)row[key]=Number(row[key]??0)+Number((value as Row).increment);
    else row[key]=value;
  }};
  const model=(name:string)=>{
    const rows=(query:Query={})=>tables[name].filter(row=>matches(row,query.where)).sort((a,b)=>{
      for(const order of [query.orderBy??{}].flat())for(const [key,direction]of Object.entries(order)){
        const left=a[key],right=b[key];const result=left!<right!?-1:left!>right!?1:0;if(result)return direction==='desc'?-result:result;
      }return 0;
    });
    const project=(row:Row|undefined,query:Query)=>!row?null:query.select?Object.fromEntries(Object.keys(query.select).map(key=>[key,row[key]])) : {...row,...(query.include?.bulkEditItems ? {bulkEditItems:tables.bulkEditJobItem.filter(item=>item.jobId===row.id&&item.status==="FAILED")}:{})};
    return {
      findFirst:async(query:Query)=>project(rows(query)[0],query),
      findUnique:async(query:Query)=>project(rows(query)[0],query),
      findFirstOrThrow:async(query:{where?:Row})=>{const row=rows(query)[0];assert.ok(row);return row;},
      findMany:async(query:Query={})=>rows(query).slice(0,query.take).map(row=>project(row,query)),
      create:async(query:{data:Row})=>{const row={id:`row-${++id}`,status:'QUEUED',errors:[],metadata:{},completedProductIds:[],processed:0,succeeded:0,failed:0,observedAt:new Date(),createdAt:new Date(),updatedAt:new Date(),startedAt:null,completedAt:null,dismissedAt:null,...query.data};tables[name].push(row);return row;},
      update:async(query:{where:Row;data:Row})=>{const row=rows(query)[0];assert.ok(row);applyMockData(row,query.data);return row;},
      updateMany:async(query:{where:Row;data:Row})=>{const found=rows(query);found.forEach(row=>applyMockData(row,query.data));return {count:found.length};},
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
  let shippingHtml:string|null=null;
  let failScrape:Error|null=null;
  let reviseSuccess=true, addSuccess=true;
  let remoteQuantity:number|null=null;
  let remoteVariants:Array<{sku:string;price:number;quantity:number}>|null=null;
  let remoteStatus="Active", partial=false;
  let afterInventoryWrite=()=>{};
  let listingXml="";
  const listingRequests:string[]=[];
  const inventoryRequests:string[]=[];
  const operations:Row[]=[];
  const observed=()=>{
    const at=new Date(), selected=shippingHtml ? extractAmazonPriceSnapshot(shippingHtml,'B0TEST1234').priceChoices.regular : null;
    if(shippingHtml)assert.ok(selected,'Fixture must have an accepted Regular offer');
    const price=selected?.price ?? 96.75;
    return {price,stockLeft:4,detectedAsin:'B0TEST1234',identityOutcome:'MATCH',buyBoxOutcome:'AVAILABLE',postcodeVerified:true,selectedPriceMode:'REGULAR',observedAt:at,
      priceChoices:{regular:price,deal:null},shippingEvidence:shippingHtml && selected ? extractAmazonShippingEvidenceFromHtml(shippingHtml,selected,'2217',at) :
        parseAmazonShippingEvidence({asin:'B0TEST1234',mode:'REGULAR',postcode:'2217',observedAt:at,source:'fixture',arrivalText:currentArrival,associated:true})};
  };
  const fixtureModule={exports:{}};
  vm.runInNewContext(await compiled,{module:fixtureModule,exports:fixtureModule.exports,require:createRequire(import.meta.url),process,console,Buffer,URL,URLSearchParams,Date,Intl,Response,Request,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,
    fetch:()=>{throw Error('Unexpected network call');},globalThis:{database,operations,Prisma,beforeStoreNumber:()=>beforeStoreNumber(),authenticate:()=>authenticated?{user:{id:"user"}}:null,sessionStore:()=>sessionStore,
      scrape:async()=>{scrapes++;if(failScrape)throw failScrape;return {...observed(),...scrapeOverrides};},
      inventoryRead:()=>'<GetItemResponse><Ack>Success</Ack><Item><ItemID>'+product.ebayItemId+'</ItemID><StartPrice currencyID="AUD">125</StartPrice><Quantity>'+(remoteQuantity??product.quantity??1)+'</Quantity><SellingStatus><ListingStatus>'+remoteStatus+'</ListingStatus><QuantitySold>0</QuantitySold></SellingStatus>'+
        (remoteVariants?'<Variations>'+remoteVariants.map(v=>'<Variation><SKU>'+v.sku+'</SKU><StartPrice currencyID="AUD">'+v.price+'</StartPrice><Quantity>'+v.quantity+'</Quantity><SellingStatus><QuantitySold>0</QuantitySold></SellingStatus></Variation>').join('')+'</Variations>':'')+listingXml+'</Item></GetItemResponse>',
      inventoryWrite:async(xml:string)=>{
        revisions++;inventoryRequests.push(xml);
        const raw=new XMLParser({parseTagValue:false}).parse(xml).ReviseInventoryStatusRequest.InventoryStatus;
        const entries=Array.isArray(raw)?raw:[raw];
        if(reviseSuccess)entries.forEach((entry:Record<string,string>,i:number)=>{
          if(partial&&i>0)return;
          const target=remoteVariants?.find(v=>v.sku===entry.SKU);
          if(target){if(entry.StartPrice!==undefined)target.price=Number(entry.StartPrice);if(entry.Quantity!==undefined)target.quantity=Number(entry.Quantity);}
          else if(entry.Quantity!==undefined)remoteQuantity=Number(entry.Quantity);
        });
        afterInventoryWrite();
        return reviseSuccess&&!partial?{success:true}:{success:false,errors:[{code:"219",severity:"Error",message:"Synthetic eBay failure",parameters:partial?{SKU:entries[1].SKU}:{},system:false}],errorMessage:"Synthetic eBay failure"};
      },
      add:async()=>{adds++;return addSuccess?{success:true,itemId:'123456789012'}:{success:false,errorMessage:'Synthetic eBay failure'};},revise:async(xml:string)=>{revisions++;listingRequests.push(xml);if(reviseSuccess)listingXml=xml.match(/<Item>([\s\S]*)<\/Item>/)?.[1].replace(/<ItemID>[\s\S]*?<\/ItemID>/,'')??'';return {success:reviseSuccess,errorMessage:reviseSuccess?undefined:'Synthetic eBay failure'};}}});
  const api=fixtureModule.exports as {guardAmazonUploadShipping:typeof guardAmazonUploadShipping;uploadProductToEbay:typeof uploadProductToEbay;createOrReuseEbayUploadJob:typeof createOrReuseEbayUploadJob;
    queueAmazonShippingHold:typeof queueAmazonShippingHold;queuePriceCheckAutoResumeForRun:typeof queuePriceCheckAutoResumeForRun;requestUpload:typeof POST;cancelShippingConfirmation:typeof DELETE;getCurrentEbayActionJobs:(storeId:string)=>Promise<Array<{id:string;errors:Array<{shippingConfirmation?:unknown}>}>>;resolveShippingApproval:typeof resolveShippingApproval;processProduct:(job:Row,id:string)=>Promise<{ok:boolean;failure:Row|null}>;markProgress:(job:Row,id:string,succeeded:boolean,failure:Row|null)=>Promise<void>;approveSingle:(request:Request)=>Promise<Response>;approveBulk:(request:Request)=>Promise<Response>;retryBulk:(request:Request,params:{params:Promise<{id:string}>})=>Promise<Response>};
  return {api,product,settings,tables,operations,inventoryRequests,listingRequests,afterInventoryWrite:(hook:()=>void)=>{afterInventoryWrite=hook;},setInventory:(values:Array<{sku:string;price:number;quantity:number}>)=>{remoteVariants=structuredClone(values);},
    remoteInventory:()=>remoteVariants,setRemoteStatus:(status:string)=>{remoteStatus=status;},setPartial:()=>{partial=true;},input:{product:product as unknown as Parameters<typeof guardAmazonUploadShipping>[0]['product'],userId:'user'},counts:()=>({scrapes,adds,revisions}),
    beforeMarketplaceWrite:(callback:()=>void)=>{beforeStoreNumber=callback;},setAuthenticated:(value:boolean)=>{authenticated=value;},setStore:(value:string)=>{sessionStore=value;},setScrapeOverrides:(value:Row)=>{scrapeOverrides=value;},
    setHtml:(html:string)=>{shippingHtml=html.replaceAll('B0FPQNVHG8','B0TEST1234').replaceAll('B0FPKSQ4WW','B0TEST1234');},setArrival:(text:string|null)=>{currentArrival=text;},setScrapeError:(error:Error)=>{failScrape=error;},setAddSuccess:(value:boolean)=>{addSuccess=value;},setReviseSuccess:(value:boolean)=>{reviseSuccess=value;},
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

test('real extraction feeds the actual uploader and background worker without false confirmation',async()=>{
  for(const html of [normalShippingOffer('FREE delivery tomorrow','Or fastest delivery today'),accordionShippingOffers().replace(/Saturday, 10 October/g,'tomorrow')]){
    for(const background of [false,true]){
      const f=await fixture();f.setHtml(html);
      const result=background ? await f.api.processProduct((await f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product']})).job,'product') :
        await f.api.uploadProductToEbay({productId:'product',storeId:'store',userId:'user'});
      assert.equal(result.ok,true);assert.equal(f.counts().adds,1);assert.equal(f.product.status,'IMPORTED');
    }
  }
});
test('real extraction preserves over-limit blocking and durable unknown confirmations',async()=>{
  for(const [html,status,scrapes] of [
    [normalShippingOffer('FREE delivery in 26 days','Or fastest delivery tomorrow'),422,1],
    [normalShippingOffer('','Or fastest delivery tomorrow'),409,2],
    [normalShippingOffer().replace('Saturday, 10 October','tomorrow').replace('<div id="availability">','<div id="mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_SMALL">FREE delivery in 26 days</div><div id="availability">'),409,2],
  ] as const){
    const f=await fixture();f.setHtml(html);
    const result=await f.api.uploadProductToEbay({productId:'product',storeId:'store',userId:'user'});
    assert.equal(result.ok,false);assert.equal(result.status,status,JSON.stringify(result.body));assert.equal(f.counts().adds,0);assert.equal(f.product.status,'DRAFT');assert.equal(f.counts().scrapes,scrapes);
    if(status===409)assert.ok(result.body.shippingConfirmation);
  }
});

test('improved real shipping extraction never bypasses other recovery safeguards',async()=>{
  for(const scenario of ['unknown-stock','identity','manual','review','pending-price'] as const){
    const f=await fixture();f.setHtml(normalShippingOffer('FREE delivery tomorrow','Or fastest delivery today'));
    Object.assign(f.product,{status:'ON_HOLD',ebayItemId:'123456789012',quantity:0,holdOrigin:scenario==='manual'?'MANUAL':scenario==='review'?'UNKNOWN':'AMAZON_LOW_STOCK'});
    const observation=f.commit();
    assert.equal((observation.shippingEvidence as Row).outcome,'VERIFIED');
    if(scenario==='unknown-stock')Object.assign(observation,{stockLeft:null});
    if(scenario==='identity')observation.identityOutcome='MISMATCH';
    if(scenario==='pending-price')f.product._count={priceHistory:1};
    await f.api.processProduct({id:'resume',storeId:'store',userId:'user',type:'RESUME',metadata:{kind:'price-check-auto-resume'}},'product');
    assert.equal(f.counts().revisions,0,scenario);assert.equal(f.product.status,'ON_HOLD',scenario);
  }
});

test('real New/Used extraction reaches upload and supplies immediate quiet display without a tracking commit',async()=>{
  for(const background of [false,true]){
    const f=await fixture();f.setHtml(newAndUsedShippingOffers().replaceAll('Sunday, 11 October','tomorrow').replaceAll('Thursday, 15 October','in 9 days'));
    const result=background ? await f.api.processProduct((await f.api.createOrReuseEbayUploadJob({storeId:'store',userId:'user',productIds:['product']})).job,'product') :
      await f.api.uploadProductToEbay({productId:'product',storeId:'store',userId:'user'});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(f.counts().adds,1);assert.equal(f.product.status,'IMPORTED');
    assert.equal(f.product.lastPriceCheck,undefined);assert.equal(f.product.holdLastObservationId,undefined);
    const presentation=getProductShippingPresentation(f.product,[...f.tables.amazonPriceObservation] as unknown as ShippingDisplayObservation[],{maxShippingDays:25,scrapePostcode:'2217'});
    assert.equal(presentation.amazonShippingDisplay?.state,'QUIET');
    assert.equal(presentation.amazonShippingStatus?.outcome,'UNKNOWN');
  }
});

test('quiet display of valid expired evidence cannot authorize either upload or restoration',async()=>{
  for(const action of ['upload','restore'] as const){
    const f=await fixture();const row=f.commit(), stale=new Date(Date.now()-16*60_000);
    Object.assign(row,{observedAt:stale,price:96.75,regularPrice:96.75,dealPrice:null,eligibleOffer:true,
      shippingEvidence:parseAmazonShippingEvidence({asin:'B0TEST1234',mode:'REGULAR',postcode:'2217',observedAt:stale,source:'fixture',arrivalText:'delivery tomorrow',associated:true})});
    f.product.lastPriceCheck=stale;
    const display=getProductShippingPresentation(f.product,[row] as unknown as ShippingDisplayObservation[],{maxShippingDays:25,scrapePostcode:'2217'});
    assert.equal(display.amazonShippingDisplay?.state,'QUIET');assert.equal(display.amazonShippingStatus?.outcome,'UNKNOWN');
    if(action==='upload'){
      f.setArrival(null);
      const result=await f.api.guardAmazonUploadShipping(f.input);
      assert.equal(result.allowed,false);assert.equal(f.counts().scrapes,2);assert.equal(f.counts().adds,0);
    }else{
      Object.assign(f.product,{status:'ON_HOLD',quantity:0,ebayItemId:'123456789012',holdOrigin:'PRICE_CHECK_FAILURE'});
      await f.api.processProduct({id:'resume',storeId:'store',userId:'user',type:'RESUME',metadata:{kind:'price-check-auto-resume'}},'product');
      assert.equal(f.counts().revisions,0);assert.equal(f.product.status,'ON_HOLD');
    }
  }
});

function variationBulkFixture(f:Awaited<ReturnType<typeof fixture>>,count=3){
 const skus=["B09682CXNR","B0CNCP33BQ","B0CNCRBRM1"].slice(0,count);
 const variants=skus.map((sku,i)=>({id:"v"+i,productId:"product",sku,title:"Option "+i,buyPrice:new Prisma.Decimal(40+i*20),sellPrice:new Prisma.Decimal(50+i*20),
  feesPercent:0,feesFixed:0,profitPercent:10,profitFixed:0,roundCents:null as number|null,quantity:i+1,createdAt:new Date(i)}));
 f.tables.variant.push(...variants);f.product.variants=variants;Object.assign(f.product,{status:"IMPORTED",ebayItemId:count===1?"304997589004":"305059787257",quantity:1,price:new Prisma.Decimal(50)});
 f.setInventory(variants.map(v=>({sku:v.sku,price:Number(v.sellPrice),quantity:v.quantity})));
 const job={id:"bulk",status:"RUNNING",type:"BULK_EDIT_REVISE",storeId:"store",metadata:{fields:["feesPercent"],durable:true}};
 f.tables.ebayActionJob.push(job);
 f.tables.bulkEditJobItem.push({id:"item",jobId:"bulk",productId:"product",status:"PENDING",attempts:0,payload:{inventoryV1:{operations:[{field:"feesPercent",value:10}]}}});
 return {job,variants};
}
test("actual bulk worker sends each Baboni price and fee-only edits preserve held quantities and independent errors",async()=>{
 const f=await fixture();const {job,variants}=variationBulkFixture(f);
 Object.assign(f.product,{status:"ON_HOLD",quantity:0,priceCheckError:"Independent identity issue",priceCheckFailureCode:"AMAZON_ASIN_REDIRECT",holdReason:"Identity"});
 for(const v of variants)v.quantity=0;f.setInventory(variants.map(v=>({sku:v.sku,price:Number(v.sellPrice),quantity:0})));
 const r=await f.api.processProduct(job,"product");assert.equal(r.ok,true,JSON.stringify(r));
 assert.equal(new Set(f.remoteInventory()!.map(v=>v.price)).size,3);assert.ok(f.remoteInventory()!.every(v=>v.quantity===0));
 assert.ok(f.inventoryRequests[0].includes("<SKU>B09682CXNR</SKU>"));assert.ok(!f.inventoryRequests[0].includes("<Quantity>"));
 assert.equal(f.product.status,"ON_HOLD");assert.equal(f.product.priceCheckError,"Independent identity issue");assert.equal(f.product.holdReason,"Identity");
 assert.equal(f.tables.bulkEditJobItem[0].status,"SUCCEEDED");
});
test("actual bulk worker preserves partial confirmations and reconciles without another request",async()=>{
 const f=await fixture();const {job,variants}=variationBulkFixture(f);f.setPartial();
 const r=await f.api.processProduct(job,"product");assert.equal(r.ok,false);assert.equal(Number(variants[0].sellPrice),f.remoteInventory()![0].price);assert.equal(Number(variants[1].sellPrice),70);
 const before=f.inventoryRequests.length;await f.api.processProduct(job,"product");assert.equal(f.inventoryRequests.length,before);assert.equal(Number(variants[1].feesPercent),0);
});
test("actual quantity-only bulk worker does not reprice and targets every variation",async()=>{
 const f=await fixture();const {job}=variationBulkFixture(f);job.metadata.fields=["quantity"];
 f.tables.bulkEditJobItem[0].payload={inventoryV1:{operations:[{field:"quantity",value:4}]}};
 assert.equal((await f.api.processProduct(job,"product")).ok,true);assert.ok(!f.inventoryRequests[0].includes("<StartPrice>"));assert.ok(f.remoteInventory()!.every(v=>v.quantity===4));
 assert.deepEqual(f.remoteInventory()!.map(v=>v.price),[50,70,90]);
});
test("actual one-option variation update still supplies SKU and rejects ended eBay listing",async()=>{
 const f=await fixture();const {job,variants}=variationBulkFixture(f,1);variants[0].sku="B07G5B97VD";
 f.setInventory([{sku:"B07G5B97VD",price:50,quantity:1}]);
 assert.equal((await f.api.processProduct(job,"product")).ok,true);assert.ok(f.inventoryRequests[0].includes("<SKU>B07G5B97VD</SKU>"));
 const ended=await fixture();const fixtureJob=variationBulkFixture(ended).job;ended.setRemoteStatus("Completed");
 const result=await ended.api.processProduct(fixtureJob,"product");assert.equal(result.ok,false);assert.equal(result.failure?.retryEligible,false);assert.equal(ended.inventoryRequests.length,0);assert.match(String(result.failure?.error),/listing has ended/);
});
test("actual hold zeros all live variations; recovery cannot resume several from one Amazon observation",async()=>{
 const f=await fixture();const {variants}=variationBulkFixture(f);
 assert.equal((await f.api.processProduct({id:"hold-vars",storeId:"store",type:"HOLD",metadata:{}},"product")).ok,true);
 assert.equal(f.product.status,"ON_HOLD");assert.ok(f.remoteInventory()!.every(v=>v.quantity===0));
 Object.assign(f.product,{holdOrigin:"AMAZON_SHIPPING_DELAY",priceCheckError:null,priceCheckFailureCode:null});f.commit();
 const before=f.inventoryRequests.length;
 const r=await f.api.processProduct({id:"resume-vars",storeId:"store",type:"RESUME",metadata:{kind:"price-check-auto-resume"}},"product");
 assert.equal(r.ok,false);assert.equal(f.inventoryRequests.length,before);assert.equal(f.product.holdReason,"These variations need verification before stock can be restored.");
 assert.equal(variants.length,3);
});

test("actual retry endpoint preserves 405 successes and skips the ended listing, including duplicate clicks",async()=>{
 const f=await fixture(),now=new Date();
 const ids=Array.from({length:411},(_,i)=>"p"+i);
 const errors=ids.slice(405).map((productId,i)=>({productId,title:"Failure "+i,error:i===5?"This eBay listing has ended.":"Variation SKU required"}));
 const job={id:"incident",storeId:"store",type:"BULK_EDIT_REVISE",status:"COMPLETED",total:411,processed:411,succeeded:405,failed:6,
  productIds:ids,completedProductIds:ids,errors,metadata:{durable:true,fields:["feesPercent"]},createdAt:now,updatedAt:now,startedAt:now,completedAt:now,dismissedAt:null,errorMessage:null};
 f.tables.ebayActionJob.push(job);
 for(const productId of ids.slice(405))f.tables.bulkEditJobItem.push({id:productId,jobId:"incident",productId,status:"FAILED",payload:{operations:[{field:"feesPercent",value:10}]}});
 const request=()=>new Request("http://localhost/api/products/bulk-edit/jobs/incident/retry",{method:"POST"});
 const results=await Promise.all([f.api.retryBulk(request(),{params:Promise.resolve({id:"incident"})}),f.api.retryBulk(request(),{params:Promise.resolve({id:"incident"})})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[202,409]);
 assert.equal(job.succeeded,405);assert.equal(job.failed,1);assert.equal(job.processed,406);
 assert.equal(f.tables.bulkEditJobItem.filter(i=>i.status==="PENDING").length,5);assert.equal(f.tables.bulkEditJobItem.at(-1)!.status,"FAILED");
 assert.equal(f.inventoryRequests.length,0);
});


test("actual mixed bulk edit preserves the title step when later inventory targets fail",async()=>{
 const f=await fixture();const {job}=variationBulkFixture(f);job.metadata.fields=["title","feesPercent"];
 f.tables.bulkEditJobItem[0].payload={inventoryV1:{operations:[{field:"title",mode:"set",value:"Updated Baboni door"},{field:"feesPercent",value:10}]}};
 f.setPartial();
 const result=await f.api.processProduct(job,"product");
 assert.equal(result.ok,false,JSON.stringify(result));assert.equal(f.product.title,"Updated Baboni door");
 assert.equal(f.listingRequests.length,1);assert.ok(!f.listingRequests[0].includes("<StartPrice>"));assert.ok(!f.listingRequests[0].includes("<Quantity>"));
 await f.api.processProduct(job,"product");assert.equal(f.listingRequests.length,1);assert.equal(f.inventoryRequests.length,1);
});

test("actual individual revision addresses each variation independently and preserves independent errors",async()=>{
 const f=await fixture();const {variants}=variationBulkFixture(f);f.product.images=["https://i.ebayimg.com/images/g/fixture/s-l1600.jpg"];f.product.errorMessage="Unresolved stock issue";
 const result=await f.api.processProduct({id:"individual",storeId:"store",type:"REVISE_LISTING",metadata:{quantityChanged:false}},"product");
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(f.listingRequests.length,1);
 assert.ok(!f.listingRequests[0].includes("<StartPrice>"));assert.ok(!f.listingRequests[0].includes("<Quantity>"));
 assert.deepEqual(f.remoteInventory()!.map(v=>v.price),variants.map(v=>Number(v.sellPrice)));
 assert.equal(f.product.errorMessage,"Unresolved stock issue");
});

test("legacy applied bulk item reconciles the marketplace before preparing any resend",async()=>{
 const f=await fixture();const {job,variants}=variationBulkFixture(f);
 const snapshot={product:{...f.product,updatedAt:new Date().toISOString(),price:String(f.product.price)},variants:variants.map(v=>({...v,sellPrice:String(v.sellPrice)}))};
 assert.equal((await f.api.processProduct(job,"product")).ok,true);
 const before=f.inventoryRequests.length;
 f.tables.listingOperation.length=0;
 f.tables.bulkEditJobItem[0].status="APPLYING";
 f.tables.bulkEditJobItem[0].payload={operations:[{field:"feesPercent",value:10}],snapshot};
 assert.equal((await f.api.processProduct(job,"product")).ok,true);
 assert.equal(f.inventoryRequests.length,before);
});


test("actual single and bulk approvals update only represented variation histories",async()=>{
 for(const bulk of [false,true]){
  const f=await fixture();const {variants}=variationBulkFixture(f);const at=new Date();f.product.lastPriceCheck=at;
  f.product.priceCheckError="Independent identity warning";
  f.tables.priceHistory.push({id:"approved",productId:"product",product:{storeId:"store"},variantId:"v1",createdAt:at,appliedAt:null,status:"PENDING",
   newPrice:new Prisma.Decimal(62),newSellPrice:new Prisma.Decimal(88),oldPrice:new Prisma.Decimal(60),oldSellPrice:new Prisma.Decimal(70)});
  const request=new Request("http://localhost/api/price-check/"+(bulk?"bulk-apply":"apply"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bulk?{productIds:["product"]}:{priceHistoryId:"approved"})});
  const response=await (bulk?f.api.approveBulk(request):f.api.approveSingle(request));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.equal(f.remoteInventory()![1].price,88);assert.deepEqual(f.remoteInventory()!.map(v=>v.quantity),[1,2,3]);
  assert.equal(Number(variants[0].sellPrice),50);assert.equal(Number(variants[2].sellPrice),90);assert.equal(Number(f.product.price),50);
  assert.equal(f.product.priceCheckError,"Independent identity warning");assert.equal(f.tables.priceHistory[0].status,"APPLIED");
  assert.equal(f.inventoryRequests[0].match(/<InventoryStatus>/g)?.length,1);assert.ok(f.inventoryRequests[0].includes("<SKU>B0CNCP33BQ</SKU>"));
 }
});


test("actual worker can clear rounding without changing held quantities",async()=>{
 const f=await fixture();const {job,variants}=variationBulkFixture(f);for(const v of variants)v.roundCents=99;
 job.metadata.fields=["roundCents"];f.tables.bulkEditJobItem[0].payload={inventoryV1:{operations:[{field:"roundCents",value:null}]}};
 assert.equal((await f.api.processProduct(job,"product")).ok,true);assert.ok(variants.every(v=>v.roundCents===null));
 assert.deepEqual(f.remoteInventory()!.map(v=>v.quantity),[1,2,3]);
});
test("context change during eBay confirmation preserves the checkpoint without overwriting a newer local edit",async()=>{
 const f=await fixture();const {job,variants}=variationBulkFixture(f);f.afterInventoryWrite(()=>{variants[0].feesPercent=22;});
 const result=await f.api.processProduct(job,"product");assert.equal(result.ok,false);
 assert.ok((result.failure?.variationResults as Row[])?.some(t=>t.state==="CONFIRMED"&&!t.applied));
 assert.equal(variants[0].feesPercent,22);assert.equal(Number(variants[0].sellPrice),50);
 assert.equal(f.tables.listingOperation[0].stage,"PREPARED");
 assert.equal((await f.api.processProduct(job,"product")).ok,false);assert.equal(f.inventoryRequests.length,1);
});
test("actual progress checkpoint counts each retried product once and produces 410 successes / 1 ended failure",async()=>{
 const f=await fixture();const ids=Array.from({length:411},(_,i)=>"p"+i);
 const job={id:"progress",storeId:"store",productIds:ids,completedProductIds:[...ids.slice(0,405),ids[410]],processed:406,succeeded:405,failed:1,errors:[{productId:ids[410],title:"Ended",error:"This eBay listing has ended."}]};
 f.tables.ebayActionJob.push(job);
 for(const id of ids.slice(405,410))await Promise.all([f.api.markProgress(job,id,true,null),f.api.markProgress(job,id,true,null)]);
 assert.equal(job.succeeded,410);assert.equal(job.failed,1);assert.equal(job.processed,411);assert.equal(new Set(job.completedProductIds).size,411);
 assert.equal(f.inventoryRequests.length,0);
});


test("ordinary listing price changed during confirmation is not overwritten",async()=>{
 const f=await fixture();Object.assign(f.product,{status:"IMPORTED",ebayItemId:"ordinary",images:["https://i.ebayimg.com/images/g/fixture/s-l1600.jpg"]});
 f.afterInventoryWrite(()=>{f.product.price=140;});
 const result=await f.api.processProduct({id:"ordinary-edit",storeId:"store",type:"REVISE_LISTING",metadata:{}}, "product");
 assert.equal(result.ok,false);assert.equal(f.product.price,140);assert.match(String(result.failure?.error),/price changed/);
 assert.equal(f.tables.listingOperation[0].stage,"PREPARED");
});
test("successful approval preserves an independent failure code without a message",async()=>{
 const f=await fixture();variationBulkFixture(f);const at=new Date();f.product.lastPriceCheck=at;f.product.priceCheckError=null;f.product.priceCheckFailureCode="AMAZON_ASIN_REDIRECT";
 f.tables.priceHistory.push({id:"approve-code",productId:"product",product:{storeId:"store"},variantId:"v1",createdAt:at,appliedAt:null,status:"PENDING",newPrice:new Prisma.Decimal(60),newSellPrice:new Prisma.Decimal(88)});
 const response=await f.api.approveSingle(new Request("http://localhost/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({priceHistoryId:"approve-code"})}));
 assert.equal(response.status,200);assert.equal(f.product.priceCheckFailureCode,"AMAZON_ASIN_REDIRECT");
});


test("workers reject an unsupported prepared bulk payload before any marketplace call",async()=>{
 const f=await fixture();const {job}=variationBulkFixture(f);f.tables.bulkEditJobItem[0].payload={inventoryVersion:2,inventoryV1:{operations:[{field:"feesPercent",value:10}]}};
 const result=await f.api.processProduct(job,"product");assert.equal(result.ok,false);assert.match(String(result.failure?.error),/Unsupported/);
 assert.equal(f.inventoryRequests.length,0);assert.equal(f.listingRequests.length,0);
});
