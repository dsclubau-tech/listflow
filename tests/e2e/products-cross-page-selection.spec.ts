import {expect,test,type Page} from "playwright/test";
import {build} from "esbuild";
import {createServer,type Server} from "node:http";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
const harnessSource = "\nimport React from \"react\";\nimport {createRoot} from \"react-dom/client\";\nimport Products from \"./components/ProductsPageClient\";\nimport Drafts from \"./components/DraftsTable\";\nconst board = window.productsHarness = { url: \"/products?pageSize=10\", refreshes: 0 };\nconst rows = (store) => Array.from({length:30}, (_,i) => ({\n  id:store+\"-p\"+(i+1),storeId:store,title:\"Product \"+(i+1),status:i<20?\"IMPORTED\":\"ON_HOLD\",\n  asin:i===9||i===19?null:\"B012345678\",ebayItemId:String(300000000000+i),images:[],\n  price:\"125\",amazonPrice:\"100\",quantity:5,amazonStockQuantity:5,\n  createdAt:\"2026-10-10T00:00:00Z\",updatedAt:\"2026-10-10T00:00:00Z\",\n  store:{id:store,name:\"Fixture Store\",loginId:store},createdBy:{id:\"u\",name:\"Fixture User\"},\n  variants:[{id:\"v\"+i,title:\"Default\",buyPrice:\"100\",sellPrice:\"125\",feesPercent:10,feesFixed:0,quantity:5}],\n  _count:{variants:1},priceHistory:i%3===0?[{id:\"history\"+i,appliedAt:null,previousPrice:\"90\",newPrice:\"100\",changePercent:10,createdAt:\"2026-10-10T00:00:00Z\"}]:[],\n}));\nfunction App() {\n  const [url,setUrl]=React.useState(board.url);\n  const [store,setStore]=React.useState(\"store-a\");\n  const [revision,setRevision]=React.useState(0);\n  const [away,setAway]=React.useState(false);\n  const [draft,setDraft]=React.useState(false);\n  board.url=url;\n  board.navigate=(value)=>setUrl(value);\n  board.refresh=()=>{board.refreshes++;setRevision(value=>value+1);};\n  board.setStore=setStore;\n  board.leave=()=>setAway(true);board.return=()=>setAway(false);board.drafts=()=>setDraft(true);\n  board.updateFirst=()=>{board.changed=true;board.refresh();};\n  const params=new URLSearchParams(url.split(\"?\")[1]);\n  const page=Number(params.get(\"page\")||1),size=Number(params.get(\"pageSize\")||10);\n  const all=React.useMemo(()=>rows(store),[store,revision]);\n  if(board.changed)all[0].status=\"ON_HOLD\";\n  board.rows=all;\n  const visible=all.slice((page-1)*size,page*size);\n  if(away)return <button onClick={()=>setAway(false)}>Return to Products</button>;\n  if(draft)return <Drafts products={visible.map(p=>({...p,status:\"DRAFT\"}))} onToast={()=>{}} />;\n  return <Products key={store} storeId={store} products={visible} totalCount={all.length}\n    page={page} pageSize={size} sortBy={params.get(\"sortBy\")} sortOrder={params.get(\"sortOrder\")||\"asc\"}\n    importedFilter={null} productFilter=\"all\" hasAdvancedFilters={false}\n    supplierOptions={[{id:store,name:\"Fixture Store\"}]} />;\n}\ncreateRoot(document.getElementById(\"root\")).render(<React.StrictMode><App /></React.StrictMode>);\n";
let server:Server,origin:string,script:string,css:string;
test.beforeAll(async()=>{
 const result=await build({stdin:{contents:harnessSource,resolveDir:process.cwd(),loader:"tsx"},
  bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
  plugins:[{name:"fixture-navigation",setup(builder){
   builder.onResolve({filter:/^(next\/navigation|next\/image|next\/dynamic)$|InlineEditForm$/},args=>({path:args.path,namespace:"fixture"}));
   builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({resolveDir:process.cwd(),loader:"jsx",contents:
    args.path==="next/navigation"?'import React from "react"; const router={push:(url)=>window.productsHarness.navigate(url),replace:(url)=>window.productsHarness.navigate(url),refresh:()=>window.productsHarness.refresh(),prefetch:()=>{}};export function useRouter(){return router};export const usePathname=()=>"/products";export const useSearchParams=()=>React.useMemo(()=>new URLSearchParams(window.productsHarness.url.split("?")[1]),[window.productsHarness.url]);':
    args.path==="next/image"?'import React from "react";export default function Image({priority,fill,unoptimized,...props}){return <img {...props}/>;}':
    args.path==="next/dynamic"?'import React from "react";export default function dynamic(){return function Dialog(props){return props.open?<div data-testid="selection-dialog"><pre>{JSON.stringify(props.selectedProductIds)}</pre><button onClick={props.onClose}>Close editor</button></div>:null;};}':
    'export default function InlineEditForm(){return null;}'
   }));
  }}]});
 script=result.outputFiles[0].text;
 const from=path.resolve("app/globals.css");
 css=(await postcss([tailwindcss()]).process(fs.readFileSync(from,"utf8"),{from})).css;
 server=createServer((req,res)=>{
  if(req.url==="/fixture.js"){res.setHeader("Content-Type","text/javascript");res.end(script);}
  else if(req.url==="/fixture.css"){res.setHeader("Content-Type","text/css");res.end(css);}
  else{res.setHeader("Content-Type","text/html");res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="font-family:Arial"><main style="padding:24px"><div id="root"></div></main><script src="/fixture.js"></script></body></html>');}
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 origin="http://127.0.0.1:"+(server.address() as {port:number}).port;
});
test.afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));});
type Board={navigate(url:string):void;refresh():void;setStore(id:string):void;leave():void;return():void;drafts():void;updateFirst():void;rows:Array<Record<string,unknown>>};
declare global {interface Window{productsHarness:Board}}
async function setup(page:Page){
 const failures:string[]=[];page.on("pageerror",e=>failures.push(e.message));
 const posts:Array<{path:string;body:{productIds?:string[];all?:boolean}}>=[];
 const control={fail:false,hold:false,release:()=>{},selectionFail:false,holdJob:false,releaseJob:()=>{}};
 await page.route("**/api/**",async route=>{
  const url=new URL(route.request().url()),method=route.request().method();
  if(url.pathname==="/api/products/selection"){
   if(control.hold)await new Promise<void>(resolve=>{control.release=resolve;});
   if(control.selectionFail){await route.fulfill({status:500,json:{error:"Fixture metadata failure"}});return;}
   const rows=await page.evaluate(()=>window.productsHarness.rows);
   await route.fulfill({json:{products:rows.map(row=>({...row,hasPendingPriceChange:(row.priceHistory as unknown[]).length>0})),totalCount:rows.length}});return;
  }
  if(method==="POST" || method==="PATCH"){
   const body=route.request().postDataJSON();posts.push({path:url.pathname,body});
   if(control.fail){await route.fulfill({status:500,json:{error:"Fixture rejected job"}});return;}
   if(url.pathname==="/api/price-check/jobs"){
    if(control.holdJob)await new Promise<void>(resolve=>{control.releaseJob=resolve;});
    await route.fulfill({status:202,json:{job:{id:"fixture-job",status:"QUEUED",total:body.productIds?.length||30,checked:0,failed:0,scope:"SELECTED",createdAt:new Date().toISOString()}}});return;
   }
   await route.fulfill({json:{total:body.productIds?.length,held:body.productIds?.length,resumed:body.productIds?.length,deletedCount:body.productIds?.length,applied:body.productIds?.length,dismissed:body.productIds?.length,type:"done",percent:100}});return;
  }
  await route.fulfill({json:{job:null,jobs:[],suggestions:[],notifications:[],products:[]}});
 });
 await page.goto(origin+"/products");
 await expect(page.getByRole("checkbox",{name:"Select all listings on this page"}).first()).toBeVisible();
 return {posts,control,failures};
}
function header(page:Page){return page.getByRole("checkbox",{name:"Select all listings on this page"}).filter({visible:true}).first();}
async function selectPages(page:Page,count=2){
 for(let i=0;i<count;i++){await header(page).check();if(i<count-1)await page.getByRole("button",{name:"Next",exact:true}).click();}
 await expect(page.getByRole("button",{name:"Bulk Edit",exact:true}).filter({visible:true})).toBeEnabled();
}
async function assertPaginationClear(page:Page){
 const next=page.getByRole("button",{name:"Next",exact:true});await next.scrollIntoViewIfNeeded();
 const clear=await next.evaluate(element=>{
  const r=element.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  return element.contains(document.elementFromPoint(x,y));
 });expect(clear).toBe(true);
}
test("page selection accumulates, header affects one page, and pagination is clickable",async({page})=>{
 await page.setViewportSize({width:1500,height:800});const {failures}=await setup(page);
 await selectPages(page);await expect(page.getByText("20 selected · 10 on this page").filter({visible:true}).first()).toBeVisible();
 await assertPaginationClear(page);await page.getByRole("button",{name:"Previous",exact:true}).click();
 await expect(header(page)).toBeChecked();await header(page).uncheck();
 await expect(page.getByText("10 selected · 0 on this page").filter({visible:true}).first()).toBeVisible();
 await page.getByRole("button",{name:"Next",exact:true}).click();await expect(header(page)).toBeChecked();
 await page.getByRole("button",{name:"Deselect All",exact:true}).click();await expect(header(page)).not.toBeChecked();expect(failures).toEqual([]);
});
test("price checks include eligible IDs from both pages and retain selection after rejection",async({page})=>{
 await page.setViewportSize({width:1500,height:800});const {posts,control,failures}=await setup(page);await selectPages(page);
 control.fail=true;await page.getByRole("button",{name:"Check 18 Prices",exact:true}).click();
 await expect(page.getByText("Fixture rejected job")).toBeVisible();await expect(page.getByText("20 selected · 10 on this page").filter({visible:true}).first()).toBeVisible();
 expect(posts[0].body.productIds).toHaveLength(18);expect(posts[0].body.productIds).toContain("store-a-p1");expect(posts[0].body.productIds).toContain("store-a-p11");expect(posts[0].body.all).toBeUndefined();
 control.fail=false;await page.getByRole("button",{name:"Check 18 Prices",exact:true}).click();
 await expect(page.getByRole("button",{name:"Deselect All",exact:true})).toHaveCount(0);expect(failures).toEqual([]);
});
test("an entirely ineligible selection never becomes an all-products request",async({page})=>{
 await page.setViewportSize({width:1500,height:800});const {posts}=await setup(page);
 await page.getByRole("checkbox",{name:"Select Product 10",exact:true}).check();
 await expect(page.getByRole("button",{name:"Check Selected",exact:true})).toBeDisabled();expect(posts).toEqual([]);
});
test("sort, size and refresh preserve selections; filters, store and leaving clear them",async({page})=>{
 await page.setViewportSize({width:1500,height:800});await setup(page);await selectPages(page);
 await page.evaluate(()=>window.productsHarness.navigate("/products?pageSize=10&page=2&sortBy=price&sortOrder=desc"));
 await expect(page.getByText("20 selected · 10 on this page").filter({visible:true}).first()).toBeVisible();
 await page.getByRole("combobox",{name:"Rows",exact:true}).selectOption("20");
 await expect(page.getByText("20 selected · 20 on this page").filter({visible:true}).first()).toBeVisible();
 await page.evaluate(()=>window.productsHarness.refresh());await expect(header(page)).toBeChecked();
 await page.evaluate(()=>window.productsHarness.navigate("/products?pageSize=10&q=Product"));
 await expect(page.getByRole("button",{name:"Deselect All",exact:true})).toHaveCount(0);
 await header(page).check();await page.evaluate(()=>window.productsHarness.setStore("store-b"));await expect(header(page)).not.toBeChecked();
 await header(page).check();await page.evaluate(()=>window.productsHarness.leave());await page.getByRole("button",{name:"Return to Products"}).click();await expect(header(page)).not.toBeChecked();
 await header(page).check();await page.reload();await expect(header(page)).not.toBeChecked();
});
test("loading or failed metadata permits navigation and retry without restoring cleared selections",async({page})=>{
 await page.setViewportSize({width:1500,height:800});const {control}=await setup(page);
 control.hold=true;await header(page).check();await expect(page.getByText("Loading selected product details…")).toBeVisible();
 await page.getByRole("button",{name:"Next",exact:true}).click();await expect(page.getByText("10 selected · 0 on this page").filter({visible:true}).first()).toBeVisible();
 await expect(page.getByRole("button",{name:"Bulk Edit",exact:true})).toBeDisabled();
 await page.getByRole("button",{name:"Deselect All",exact:true}).click();control.hold=false;control.release();
 await expect(page.getByRole("button",{name:"Deselect All",exact:true})).toHaveCount(0);
 control.selectionFail=true;await header(page).check();await expect(page.getByText("Fixture metadata failure")).toBeVisible();
 control.selectionFail=false;await page.getByRole("button",{name:"Retry selection details"}).click();
 await expect(page.getByText("Fixture metadata failure")).toHaveCount(0);await expect(page.getByRole("button",{name:"Bulk Edit",exact:true})).toBeEnabled();
});
test("explicit all-matching selection and editor receive all selected IDs",async({page})=>{
 await page.setViewportSize({width:1500,height:800});await setup(page);await header(page).check();
 const selectAll=page.getByRole("button",{name:"Select all 30 listings",exact:true});await expect(selectAll).toBeEnabled();await selectAll.click();
 await expect(page.getByText("30 selected · 10 on this page").filter({visible:true}).first()).toBeVisible();
 await page.getByRole("button",{name:"Bulk Edit",exact:true}).click();await expect(page.getByTestId("selection-dialog")).toContainText("store-a-p30");
 const text=await page.getByTestId("selection-dialog").locator("pre").innerText();expect(JSON.parse(text)).toHaveLength(30);
});
for(const action of [
 {name:"Put 20 On Hold",path:"/api/products/bulk-hold",count:20},
 {name:"Resume 10 On Hold",path:"/api/products/bulk-resume",count:10},
 {name:"Remove from ListFlow",path:"/api/products/bulk-remove-listflow",count:30},
 {name:"End on eBay & Remove",path:"/api/products/bulk-end",count:30},
 {name:"Apply 10 Pending",path:"/api/price-check/bulk-apply",count:10},
 {name:"Dismiss 10 Pending",path:"/api/price-check/bulk-dismiss",count:10},
 {name:"Sync 30 Ads",path:"/api/ebay/promoted-listings/sync",count:30},
]){
 test(action.name+" submits eligible products across pages",async({page})=>{
  await page.setViewportSize({width:1600,height:900});const {posts}=await setup(page);await selectPages(page,3);
  page.on("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:action.name,exact:true}).click();
  await expect.poll(()=>posts.filter(p=>p.path===action.path).length).toBe(1);
  const ids=posts.find(p=>p.path===action.path)!.body.productIds!;expect(ids).toHaveLength(action.count);expect(new Set(ids).size).toBe(action.count);
 });
}
test("mobile pagination stays clickable after closing the action drawer",async({page})=>{
 await page.setViewportSize({width:390,height:844});const {failures}=await setup(page);
 await header(page).check();await assertPaginationClear(page);await page.getByRole("button",{name:"Next",exact:true}).click();await header(page).check();
 await page.getByRole("button",{name:"Open bulk action options"}).click();await page.getByRole("dialog",{name:"Bulk actions sheet"}).getByRole("button",{name:"Close",exact:true}).click();
 await assertPaginationClear(page);await page.getByRole("button",{name:"Previous",exact:true}).click();await expect(header(page)).toBeChecked();expect(failures).toEqual([]);
});
test("Drafts retains its page-specific selection behavior",async({page})=>{
 await page.setViewportSize({width:1500,height:800});await setup(page);await page.evaluate(()=>window.productsHarness.drafts());
 await header(page).check();await page.evaluate(()=>window.productsHarness.navigate("/products?pageSize=10&page=2"));
 await expect(header(page)).not.toBeChecked();
});

test("promotion editor and copied titles include previous pages",async({page})=>{
 await page.setViewportSize({width:1500,height:800});await setup(page);await selectPages(page);
 await page.getByRole("button",{name:"Manage Promotions",exact:true}).click();
 const ids=JSON.parse(await page.getByTestId("selection-dialog").locator("pre").innerText());
 expect(ids).toHaveLength(20);expect(ids).toContain("store-a-p1");expect(ids).toContain("store-a-p20");
 await page.getByRole("button",{name:"Close editor"}).click();
 await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
 await page.getByRole("button",{name:"Copy 20 Titles",exact:true}).click();
 const text=await page.evaluate(()=>navigator.clipboard.readText());
 const lines=text.split(/\r?\n/);expect(lines).toHaveLength(20);expect(lines[0]).toBe("Product 1");expect(lines[19]).toBe("Product 20");
});
test("clearing a pending select-all request never reselects products",async({page})=>{
 await page.setViewportSize({width:1500,height:800});const {control}=await setup(page);
 control.selectionFail=true;await header(page).check();await expect(page.getByText("Fixture metadata failure")).toBeVisible();
 control.selectionFail=false;control.hold=true;
 await page.getByRole("button",{name:"Select all 30 listings",exact:true}).click();
 await expect(page.getByText("Loading selected product details…")).toBeVisible();
 await page.getByRole("button",{name:"Deselect All",exact:true}).click();control.hold=false;control.release();
 await expect(header(page)).not.toBeChecked();await expect(page.getByRole("button",{name:"Deselect All",exact:true})).toHaveCount(0);
});
test("a late response from the previous filter cannot restore selection",async({page})=>{
 await page.setViewportSize({width:1500,height:800});const {control}=await setup(page);
 control.hold=true;await header(page).check();await expect(page.getByText("Loading selected product details…")).toBeVisible();
 await page.evaluate(()=>window.productsHarness.navigate("/products?pageSize=10&q=changed"));
 control.hold=false;control.release();await expect(header(page)).not.toBeChecked();
 await expect(page.getByRole("button",{name:"Deselect All",exact:true})).toHaveCount(0);
});
test("wrapped actions and keyboard pagination remain accessible",async({page})=>{
 await page.setViewportSize({width:1500,height:800});await setup(page);await selectPages(page);
 await page.setViewportSize({width:1280,height:650});await assertPaginationClear(page);
 const next=page.getByRole("button",{name:"Next",exact:true});await next.focus();
 await expect(next).toBeFocused();await next.press("Enter");
 await expect(page.getByText("Page 3 of 3", {exact:true})).toBeVisible();
 await expect(header(page)).not.toBeChecked();
 await page.screenshot({path:"scratch/products-selection-desktop.png",fullPage:false});
});
test("a refreshed product status stays current after navigating away from its page",async({page})=>{
 await page.setViewportSize({width:1500,height:800});await setup(page);await selectPages(page);
 await page.getByRole("button",{name:"Previous",exact:true}).click();
 await page.evaluate(()=>window.productsHarness.updateFirst());
 await expect(page.getByRole("button",{name:"Put 19 On Hold",exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Next",exact:true}).click();
 await expect(page.getByRole("button",{name:"Put 19 On Hold",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Resume 1 On Hold",exact:true})).toBeVisible();
});

test("page jumps and zoom preserve page-specific checkbox state",async({page})=>{
 await page.setViewportSize({width:1500,height:800});await setup(page);await selectPages(page);
 const go=page.getByRole("button",{name:"Go",exact:true});const input=page.getByRole("spinbutton");
 await input.fill("1");await go.click();await expect(header(page)).toBeChecked();
 await page.getByRole("checkbox",{name:"Select Product 1",exact:true}).uncheck();
 expect(await header(page).evaluate((element:HTMLInputElement)=>element.indeterminate)).toBe(true);
 await page.evaluate(()=>{document.body.style.zoom="1.25";});await assertPaginationClear(page);
 await input.fill("3");await go.click();await expect(header(page)).not.toBeChecked();
 expect(await header(page).evaluate((element:HTMLInputElement)=>element.indeterminate)).toBe(false);
 await expect(page.getByText("19 selected · 0 on this page").filter({visible:true}).first()).toBeVisible();
});
test("accepted work from an earlier filter cannot clear a new selection",async({page})=>{
 await page.setViewportSize({width:1500,height:800});const {control,posts}=await setup(page);await selectPages(page);
 control.holdJob=true;await page.getByRole("button",{name:"Check 18 Prices",exact:true}).click();
 await expect.poll(()=>posts.length).toBe(1);
 await page.evaluate(()=>window.productsHarness.navigate("/products?pageSize=10&filter=on-hold"));
 await expect(header(page)).not.toBeChecked();await header(page).check();
 await expect(page.getByText("10 selected · 10 on this page").filter({visible:true}).first()).toBeVisible();
 control.holdJob=false;control.releaseJob();
 await expect(page.getByRole("button",{name:"Check 9 Prices",exact:true})).toBeEnabled();
 await expect(header(page)).toBeChecked();await expect(page.getByText("10 selected · 10 on this page").filter({visible:true}).first()).toBeVisible();
});
