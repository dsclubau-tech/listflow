import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { parseAmazonShippingEvidence } from "./amazon-shipping-evidence";
import type { GET } from "../app/api/products/[id]/route";
import type { getCachedProductsPageData } from "./products-page-data";
import { normalizeProductsQuery } from "./product-filter-query";
import type { SerializedProductRow } from "../types/product-row";

const compiled = build({
  stdin:{resolveDir:process.cwd(),loader:"ts",contents:`
    export { GET } from "./app/api/products/[id]/route";
    export { getCachedProductsPageData } from "./lib/products-page-data";
  `},bundle:true,platform:"node",format:"cjs",packages:"external",write:false,
  plugins:[{name:"read-only-product-boundaries",setup(builder){
    const mocks:Record<string,string>={
      "prisma":"export const prisma=globalThis.database;",
      "prismaClient":"export const Prisma={};",
      "@/auth":"export const auth=async()=>({user:{id:'user'}});",
      "store-session":"export const getCurrentStoreSession=async()=>({storeId:'store'});export const getInternalUserId=async()=> 'user';",
      "next/cache":"export const cacheLife=()=>{};export const cacheTag=()=>{};export const revalidateTag=()=>{};",
      "next/server":"export class NextResponse extends Response {static json(value,options){return Response.json(value,options);}}",
      "logger":"export const logger={info(){},warn(){},error(){},debug(){}};export const createRequestLogger=()=>logger;",
      "server-only":"",
    };
    builder.onResolve({filter:/^@\/app\/generated\/prisma\/client$/},()=>({path:"prismaClient",namespace:"fixture"}));
    builder.onResolve({filter:/^(?:server-only|@\/auth|next\/cache|next\/server|(?:@\/lib\/|\.\/)[\w-]+)$/},args=>{
      const key=args.path.replace(/^(?:@\/lib\/|\.\/)/,"");
      return key in mocks?{path:key,namespace:"fixture"}:undefined;
    });
    builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:mocks[args.path],loader:"ts",resolveDir:process.cwd()}));
  }}],
}).then(result=>result.outputFiles[0].text);
const now=new Date("2026-10-06T10:00:00Z"), at=new Date(now.getTime()-5*60_000);
function observation(id="committed", observedAt=at) {
 return {id,productId:"product",storeId:"store",requestedAsin:"B0DFL96H43",selectedAsin:"B0DFL96H43",
   identityOutcome:"MATCH",buyBoxOutcome:"AVAILABLE",postcodeVerified:true,verifiedPostcode:"2217",isSuccessful:true,eligibleOffer:true,
   priceMode:"REGULAR",price:67.95,regularPrice:67.95,dealPrice:null,stockLeft:4,observedAt,
   shippingEvidence:parseAmazonShippingEvidence({asin:"B0DFL96H43",mode:"REGULAR",postcode:"2217",observedAt,source:"fixture",arrivalText:"FREE delivery 15 October",associated:true})};
}
async function fixture() {
 const accepted=observation();
 const products=[{id:"product",storeId:"store",title:"Healthy Choice",asin:"B0DFL96H43",amazonPriceTrackingMode:"REGULAR",
   status:"IMPORTED",ebayItemId:"377547740480",price:88.60,amazonPrice:67.95,quantity:1,createdAt:at,updatedAt:at,
   lastPriceCheck:at,holdLastObservationId:accepted.id,priceCheckError:null,priceCheckFailureCode:null,holdOrigin:null,
   amazonStockLeft:4,amazonAvailability:"IN_STOCK",variants:[],priceHistory:[],uploadLogs:[{createdAt:at}],
   store:{id:"store",name:"Oz Metro"},createdBy:{id:"user",name:"Fixture"},_count:{priceHistory:0,variants:0},
   amazonPriceObservations:[accepted]}];
 const settings={minProductQuantity:2,maxShippingDays:25,scrapePostcode:"2217"};
 const records=[accepted],queries:Array<{where:{OR:Array<{id:string;productId:string;storeId:string}>};select:unknown}>=[];
 const database={
   product:{findFirst:async()=>products[0],findMany:async()=>products,count:async()=>products.length},
   supplierSettings:{findUnique:async()=>settings},
   amazonPriceObservation:{findMany:async(query:typeof queries[number])=>{
     queries.push(query);return records.filter(row=>query.where.OR.some(part=>part.id===row.id&&part.productId===row.productId&&part.storeId===row.storeId));
   }},
 };
 class Clock extends Date {constructor(value?: string | number | Date){super(value===undefined?now.getTime():value instanceof Date?value.getTime():value);}static now(){return now.getTime();}}
 const fixtureModule={exports:{}};
 vm.runInNewContext(await compiled,{module:fixtureModule,exports:fixtureModule.exports,require:createRequire(import.meta.url),process,console,Buffer,URL,URLSearchParams,Date:Clock,Intl,Response,Request,
   AbortController,setTimeout,clearTimeout,globalThis:{database},fetch:()=>{throw Error("Unexpected external request");}});
 const api=fixtureModule.exports as {GET:typeof GET;getCachedProductsPageData:typeof getCachedProductsPageData};
 return {products,records,queries,settings,accepted,async responses(){
   const list=JSON.parse(JSON.stringify(await api.getCachedProductsPageData("store","Oz Metro",normalizeProductsQuery({})))) as Awaited<ReturnType<typeof getCachedProductsPageData>>;
   const response=await api.GET(new Request("http://fixture.test/api/products/product"),{params:Promise.resolve({id:"product"})});
   assert.equal(response.status,200);
   const detail=await response.json() as SerializedProductRow;
   assert.deepEqual(detail.amazonShippingDisplay,list.products[0].amazonShippingDisplay);
   assert.deepEqual(detail.amazonShippingStatus,list.products[0].amazonShippingStatus);
   return {list,detail};
 }};
}
test("actual list and detail use verified upload evidence without rewriting tracking fields",async()=>{
 const f=await fixture();Object.assign(f.products[0],{lastPriceCheck:null,holdLastObservationId:null});
 const {list,detail}=await f.responses();
 assert.deepEqual(detail.amazonShippingDisplay,{state:"QUIET",message:null});
 assert.equal(detail.amazonShippingStatus?.outcome,"UNKNOWN");
 assert.equal(list.products[0].lastPriceCheck,null);assert.equal(f.products[0].holdLastObservationId,null);assert.equal(f.queries.length,0);
});
test("actual list and detail stay quiet after expiry while recovery explains the freshness gate",async()=>{
 const f=await fixture(),stale=observation("stale",new Date(now.getTime()-16*60_000));
 Object.assign(f.products[0],{status:"ON_HOLD",holdOrigin:"PRICE_CHECK_FAILURE",lastPriceCheck:stale.observedAt,holdLastObservationId:stale.id,amazonPriceObservations:[stale]});
 const {detail}=await f.responses();
 assert.equal(detail.amazonShippingDisplay?.state,"QUIET");assert.equal(detail.amazonShippingStatus?.outcome,"UNKNOWN");
 assert.match(detail.currentHoldReason!,/Fresh delivery verification is required before stock can be restored/);
});
test("referenced observations outside the latest five are loaded in one scoped batch",async()=>{
 const f=await fixture();
 f.products[0].amazonPriceObservations=Array.from({length:5},(_,i)=>({...observation("failed-"+i,new Date(at.getTime()+1000+i)),isSuccessful:false}));
 f.products.push({...f.products[0],id:"second",holdLastObservationId:"second-committed",amazonPriceObservations:[]});
 f.records.push({...f.accepted,id:"second-committed",productId:"second"});
 const {list,detail}=await f.responses();
 assert.equal(f.queries.length,2); // One list batch and one detail batch, not one per row.
 assert.equal(f.queries[0].where.OR.length,2);assert.equal(f.queries[1].where.OR.length,1);
 assert.equal(detail.amazonShippingStatus?.outcome,"WITHIN_LIMIT");assert.equal(detail.amazonShippingDisplay?.state,"UNVERIFIED");
 assert.equal((list.products[0] as unknown as {amazonVerification:{id:string}}).amazonVerification.id,"committed");
 assert.equal(list.products[1].amazonShippingDisplay?.state,"QUIET");
 assert.equal(f.products[0].amazonPriceObservations.length,5);
});
test("actual responses reject changed postcode and re-evaluate the current shipping limit",async()=>{
 const f=await fixture();f.settings.scrapePostcode="3000";
 assert.equal((await f.responses()).detail.amazonShippingDisplay?.state,"UNVERIFIED");
 f.settings.scrapePostcode="2217";f.settings.maxShippingDays=8;
 assert.equal((await f.responses()).detail.amazonShippingDisplay?.state,"OVER_LIMIT");
});
