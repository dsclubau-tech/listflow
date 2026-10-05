import { expect, test as base, type Page } from "playwright/test";
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import type { UploadShippingConfirmation } from "../../lib/amazon-upload-shipping-policy";

const origin = "http://listflow.test", productId = "shipping-draft";
const confirmation: UploadShippingConfirmation = { sourceJobId: "old-job", productId, nonce: "server-challenge", message: "Delivery unknown" };
const product = {
  id: productId, title: "Synthetic butter maker", fullTitle: "Synthetic butter maker", description: "Useful appliance.",
  category: "267", categoryName: "Books", status: "DRAFT", condition: "New", price: 173.99, quantity: 1,
  asin: null, ebayItemId: null, images: [], variants: [], templateId: null, policyTemplateId: null,
  paymentPolicyId: "payment-test", shippingPolicyId: "shipping-test", returnPolicyId: "return-test",
  promotedAdPercent: 0, amazonPriceTrackingMode: "REGULAR", errorMessage: null,
  createdBy: {name:"Synthetic user"}, store: { id: "synthetic-store", name: "Test store" },
  itemSpecifics: { Brand: "Acme", _Country: "AU", _PostalCode: "3175", _Location: "Dandenong North, VIC" },
};
type Job = { id: string; type: string; status: string; productIds: string[]; completedProductIds: string[];
  total: number; processed: number; succeeded: number; failed: number;
  errors: { productId: string; title: string; error: string; shippingConfirmation?: UploadShippingConfirmation }[] };
const queued = (id = "new-job"): Job => ({ id, type: "UPLOAD", status: "QUEUED", productIds: [productId],
  completedProductIds: [], total: 1, processed: 0, succeeded: 0, failed: 0, errors: [] });
const pending = (): Job => ({ ...queued("old-job"), status: "FAILED", processed: 1, failed: 1,
  completedProductIds: [productId], errors: [{ productId, title: product.title, error: "Delivery unknown", shippingConfirmation: confirmation }] });
const styles = postcss([tailwind({ base: process.cwd() })]).process(fs.readFileSync("app/globals.css", "utf8"), { from: path.resolve("app/globals.css") }).then(result => result.css);
const bundle = build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from "react"; import { createRoot } from "react-dom/client";
    import InlineEditForm from "./components/InlineEditForm"; import DraftsTable from "./components/DraftsTable";
    createRoot(document.getElementById("root")).render(<React.StrictMode>
      {window.fixtureMode === "editor" ? <InlineEditForm product={window.fixtureProducts[0]} onCollapse={() => {}} /> :
      <DraftsTable products={window.fixtureProducts} onToast={(message, variant) => {
        window.fixtureToasts.push({message, variant});
      }} autoExpandProductId={window.fixtureMode === "expanded" ? window.fixtureProducts[0].id : null} />}
    </React.StrictMode>);
  ` }, bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
  plugins: [{ name: "unrelated-integrations", setup(builder) {
    const replacements: Record<string, string> = {
      "next/navigation": 'const router={refresh(){window.fixtureRefreshes++;}}; export function useRouter(){return router;}',
      "next/link": 'import React from "react";export default function Link({children,...props}){return <a {...props}>{children}</a>;}',
      "@/components/ProductVariantsPanel": 'export default function ProductVariantsPanel(){return null;}',
      "@/components/RichTextEditor": 'import React from "react";export default function RichTextEditor({value,onChange}){return <textarea aria-label="Description" value={value} onChange={event=>onChange(event.target.value)}/>;}',
    };
    builder.onResolve({filter:/^(next\/navigation|next\/link|@\/components\/(ProductVariantsPanel|RichTextEditor))$/},
      args=>({path:args.path,namespace:"fixture"}));
    builder.onLoad({filter:/.*/,namespace:"fixture"},args=>({contents:replacements[args.path],loader:"tsx",resolveDir:process.cwd()}));
  }}],
}).then(result=>result.outputFiles[0].text);

type Fixture = {
  jobs: Job[]; mode: "editor" | "drafts" | "expanded"; outcome: "queued" | "confirmation" | "error" | "malformed";
  requests: { path: string; method: string; body: unknown }[]; nextJobsWait: Promise<void> | null;
  decisionWait: Promise<void> | null; saveFails: boolean; jobsFail: boolean; products: typeof product[];
  open(): Promise<void>;
};
const test = base.extend<{ shipping: Fixture }>({
  shipping: async ({page}, provide) => {
    const errors: string[] = [], unexpected: string[] = [];
    page.on("pageerror", error=>errors.push(error.message));
    const state: Fixture = {
      jobs: [], mode: "editor", outcome: "queued", requests: [], nextJobsWait: null, decisionWait: null, saveFails: false, jobsFail: false, products: [product],
      async open() {
        await page.goto(origin + "/shipping-editor");
        await expect.poll(()=>state.requests.some(request=>request.path==="/api/upload/jobs/current")).toBe(true);
        if (state.mode !== "drafts") await expect(page.getByRole("status",{name:"Loading payment policies"})).toHaveCount(0);
      },
    };
    await page.route("**/*",async route=>{
      const request=route.request(),url=new URL(request.url()),method=request.method();
      if(url.origin===origin&&url.pathname==="/shipping-editor"&&request.isNavigationRequest()){
        await route.fulfill({contentType:"text/html",body:`<html><head><style>${await styles}</style></head><body><div id="root"></div><script>window.fixtureMode=${JSON.stringify(state.mode)};window.fixtureProducts=${JSON.stringify(state.products)};window.fixtureToasts=[];window.fixtureRefreshes=0;</script><script>${await bundle}</script></body></html>`});
        return;
      }
      const body: unknown=request.postData()?request.postDataJSON():null;
      state.requests.push({path:url.pathname,method,body});
      if(url.origin!==origin){unexpected.push(request.url());await route.abort();return;}
      if(method==="GET"&&["/api/templates","/api/policy-templates"].includes(url.pathname))await route.fulfill({json:[]});
      else if(method==="GET"&&url.pathname==="/api/policies")await route.fulfill({json:{
        payment:[{profileId:"payment-test",profileName:"Payment"}],shipping:[{profileId:"shipping-test",profileName:"Shipping"}],returns:[{profileId:"return-test",profileName:"Returns"}],
      }});
      else if(method==="GET"&&url.pathname==="/api/upload/jobs/current"){
        const jobs=structuredClone(state.jobs),wait=state.nextJobsWait;state.nextJobsWait=null;await wait;
        await route.fulfill({status:state.jobsFail?503:200,json:{jobs}});
      }else if(method==="GET"&&url.pathname==="/api/ebay/category-aspects")await route.fulfill({json:{requiredItemSpecifics:[]}});
      else if(method==="PATCH"&&url.pathname==="/api/products/"+productId)await route.fulfill({status:state.saveFails?500:200,json:state.saveFails?{error:"Synthetic save failure"}:{id:productId}});
      else if(method==="POST"&&url.pathname==="/api/upload"){
        await state.decisionWait;
        if(state.outcome==="confirmation"||state.outcome==="malformed"){
          state.jobs=[pending()];
          await route.fulfill({status:409,json:{error:"Delivery unknown",shippingConfirmation:state.outcome==="confirmation"?confirmation:{message:"Delivery unknown"}}});
        }else if(state.outcome==="error")await route.fulfill({status:409,json:{error:"Synthetic genuine upload failure"}});
        else {state.jobs=[queued()];await route.fulfill({json:{job:state.jobs[0],message:"Upload queued"}});}
      }else if(method==="DELETE"&&url.pathname==="/api/upload/shipping-confirmation"){
        state.jobs=state.jobs.map(job=>({...job,errors:job.errors.map(error=>({...error,shippingConfirmation:undefined}))}));
        await route.fulfill({json:{success:true}});
      }else if(method==="POST"&&url.pathname==="/api/client-logs")await route.fulfill({json:{ok:true}});
      else {unexpected.push(method+" "+request.url());await route.abort();}
    });
    await provide(state);
    expect(errors).toEqual([]);expect(unexpected).toEqual([]);
  },
});
const prompt=(page:Page)=>page.getByRole("region",{name:"Shipping confirmation"});
async function expectDecision(page:Page){
  await expect(prompt(page)).toBeVisible();
  await expect(page.getByText("Shipping confirmation required",{exact:true}).first()).toBeVisible();
  await expect(page.getByText("Import failed",{exact:true})).toHaveCount(0);
  await expect(page.getByText("eBay upload failed",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Import complete",{exact:true})).toHaveCount(0);
}
test("Save & Import 409 is an amber decision, without failure reporting",async({page,shipping})=>{
  shipping.outcome="confirmation";await shipping.open();
  await page.getByRole("button",{name:"Save & Import",exact:true}).click();
  await expectDecision(page);
  await expect(prompt(page)).toHaveClass(/bg-amber-50/);
  expect(shipping.requests.filter(request=>request.path==="/api/client-logs")).toEqual([]);
});
test("completed background attempt presents confirmation rather than failure or success",async({page,shipping})=>{
  shipping.jobs=[queued("old-job")];await shipping.open();
  await expect(page.getByText("Queued for eBay",{exact:true})).toBeVisible();
  shipping.jobs=[pending()];await expectDecision(page);
  await expect(page.getByText(/1 awaiting decision/)).toBeVisible();
});
test("unresolved confirmation survives reopening",async({page,shipping})=>{
  shipping.jobs=[pending()];await shipping.open();await expectDecision(page);
  await page.reload();await expectDecision(page);
});
for(const [action,button] of [["retry","Retry check"],["approve","Upload anyway"]] as const){
  test(action+" selects the new attempt and only confirmed publication shows complete",async({page,shipping})=>{
    shipping.jobs=[queued("old-job")];await shipping.open();shipping.jobs=[pending()];await expect(prompt(page)).toBeVisible();
    await page.getByRole("button",{name:button,exact:true}).click();
    await expect(prompt(page)).toHaveCount(0);await expect(page.getByText("Queued for eBay",{exact:true})).toBeVisible();
    await expect(page.getByText("Import failed",{exact:true})).toHaveCount(0);
    const requests=shipping.requests.filter(request=>request.path==="/api/upload");
    expect(requests).toHaveLength(1);
    expect(requests[0].body).toEqual({productId,background:true,...(action==="approve"?{shippingConfirmation:confirmation}:{})});
    shipping.jobs=[{...queued(),status:"COMPLETED",processed:1,succeeded:1}];
    await expect(page.getByText("Import complete",{exact:true})).toBeVisible();
  });
}
test("cancellation removes the active decision and leaves a draft",async({page,shipping})=>{
  shipping.jobs=[queued("old-job")];await shipping.open();shipping.jobs=[pending()];await expect(prompt(page)).toBeVisible();
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(prompt(page)).toHaveCount(0);await expect(page.getByText("Import failed",{exact:true})).toHaveCount(0);
  expect(shipping.requests.filter(request=>request.path==="/api/upload")).toEqual([]);
  await page.reload();await expect(prompt(page)).toHaveCount(0);await expect(page.getByText("Import complete",{exact:true})).toHaveCount(0);
});
for(const outcome of ["error","malformed"] as const){
  test(outcome+" responses retain real failure handling",async({page,shipping})=>{
    shipping.outcome=outcome;await shipping.open();await page.getByRole("button",{name:"Save & Import",exact:true}).click();
    await expect(page.getByText("Import failed",{exact:true})).toBeVisible();
    await expect(prompt(page)).toHaveCount(0);
    await expect.poll(()=>shipping.requests.some(request=>request.path==="/api/client-logs")).toBe(true);
  });
}
test("an older poll cannot overwrite a new retry",async({page,shipping})=>{
  shipping.jobs=[queued("old-job")];await shipping.open();await expect(page.getByText("Queued for eBay",{exact:true})).toBeVisible();
  let release=()=>{};shipping.nextJobsWait=new Promise<void>(resolve=>{release=resolve;});
  const before=shipping.requests.filter(request=>request.path==="/api/upload/jobs/current").length;
  try{
    await expect.poll(()=>shipping.requests.filter(request=>request.path==="/api/upload/jobs/current").length).toBeGreaterThan(before);
    shipping.jobs=[pending()];await expect(prompt(page)).toBeVisible();
    await page.getByRole("button",{name:"Retry check",exact:true}).click();
    await expect(prompt(page)).toHaveCount(0);release();
    await expect(page.getByText("Queued for eBay",{exact:true})).toBeVisible();
    shipping.jobs=[{...queued(),status:"COMPLETED",processed:1,succeeded:1}];
    await expect(page.getByText("Import complete",{exact:true})).toBeVisible();
  }finally{release();}
});
test("Drafts mixed batches count each decision once and genuine failures separately",async({page,shipping})=>{
  shipping.mode="drafts";shipping.products=[product,{...product,id:"other-draft",title:"Other draft"}];
  const job=pending();job.status="RUNNING";job.total=3;job.processed=2;job.failed=2;job.productIds.push("other-draft","third");
  job.errors.push({...job.errors[0]},{productId:"other-draft",title:"Other draft",error:"Real marketplace failure"});
  shipping.jobs=[job];await shipping.open();
  await expect(page.getByText(/1 awaiting decision, 1 failed/)).toBeVisible();
});
test("Drafts confirmations use amber controls without a red completion toast",async({page,shipping})=>{
  shipping.mode="drafts";shipping.jobs=[queued("old-job")];await shipping.open();
  await expect(page.getByText("Queued for eBay",{exact:true})).toBeVisible();
  shipping.jobs=[pending()];await expectDecision(page);
  const toasts=await page.evaluate(()=>Reflect.get(window,"fixtureToasts"));
  expect(toasts).toEqual([]);
});
test("expanded Drafts renders one prompt and mobile decisions remain usable",async({page,shipping})=>{
  await page.setViewportSize({width:390,height:844});shipping.mode="expanded";shipping.jobs=[pending()];await shipping.open();
  await expect(prompt(page)).toHaveCount(1);await expectDecision(page);
  for(const name of ["Retry check","Upload anyway","Cancel"]) {
    const button = page.getByRole("button",{name,exact:true}); await expect(button).toBeEnabled();
    const bounds = await button.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
});


test("a genuine save failure remains red while a shipping decision is pending",async({page,shipping})=>{
  shipping.jobs=[pending()];await shipping.open();await expect(prompt(page)).toBeVisible();
  shipping.saveFails=true;await page.getByRole("button",{name:"Save",exact:true}).click();
  await expect(page.getByText("Save failed",{exact:true})).toBeVisible();
  await expect(prompt(page)).toBeVisible();
});
test("Import to eBay shows the structured decision without a red toast",async({page,shipping})=>{
  shipping.mode="drafts";shipping.outcome="confirmation";await shipping.open();
  await page.getByRole("button",{name:"Import to eBay",exact:true}).first().click();
  await expectDecision(page);
  expect(await page.evaluate(()=>Reflect.get(window,"fixtureToasts"))).toEqual([]);
});
test("a delayed reopening response cannot replace a newly queued attempt",async({page,shipping})=>{
  let release=()=>{};shipping.jobs=[pending()];shipping.nextJobsWait=new Promise<void>(resolve=>{release=resolve;});
  try{
    await shipping.open();await page.getByRole("button",{name:"Save & Import",exact:true}).click();
    await expect(page.getByText("Queued for eBay",{exact:true})).toBeVisible();release();
    await expect(prompt(page)).toHaveCount(0);
    shipping.jobs=[{...queued(),status:"COMPLETED",processed:1,succeeded:1}];
    await expect(page.getByText("Import complete",{exact:true})).toBeVisible();
  }finally{release();}
});
test("failed or cancelled background jobs with no successful publication never show complete",async({page,shipping})=>{
  shipping.jobs=[queued()];await shipping.open();
  shipping.jobs=[{...queued(),status:"CANCELLED",processed:1}];
  await expect(page.getByText("Import failed",{exact:true})).toBeVisible();
  await expect(page.getByText("eBay upload complete",{exact:true})).toHaveCount(0);
});

test("expanded Drafts refreshes its batch summary after a retry",async({page,shipping})=>{
  shipping.mode="expanded";shipping.jobs=[pending()];await shipping.open();
  await page.getByRole("button",{name:"Retry check",exact:true}).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(page.getByText("Shipping confirmation required",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Queued for eBay",{exact:true}).first()).toBeVisible();
});
test("the actual editor disables competing decisions during approval",async({page,shipping})=>{
  shipping.jobs=[pending()];await shipping.open();let release=()=>{};
  shipping.decisionWait=new Promise<void>(resolve=>{release=resolve;});
  try {
    await page.getByRole("button",{name:"Upload anyway",exact:true}).click();
    for(const name of ["Upload anyway","Retry check","Cancel"])await expect(page.getByRole("button",{name,exact:true})).toBeDisabled();
    expect(shipping.requests.filter(request=>request.path==="/api/upload")).toHaveLength(1);
  }finally {release();}
  await expect(prompt(page)).toHaveCount(0);
});

test("Drafts retains a direct confirmation when progress refresh is unavailable",async({page,shipping})=>{
  shipping.mode="drafts";shipping.outcome="confirmation";await shipping.open();shipping.jobsFail=true;
  await page.getByRole("button",{name:"Import to eBay",exact:true}).first().click();
  await expectDecision(page);
  expect(await page.evaluate(()=>Reflect.get(window,"fixtureToasts"))).toEqual([]);
  shipping.jobsFail=false;await page.reload();await expectDecision(page);
});
test("a cancelling attempt remains locked and never appears complete",async({page,shipping})=>{
  shipping.jobs=[{...queued(),status:"CANCELLING"}];await shipping.open();
  await expect(page.getByText("Cancelling - finishing current upload",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Save & Import",exact:true})).toBeDisabled();
  await expect(page.getByText("eBay upload complete",{exact:true})).toHaveCount(0);
});

test("Drafts cancellation clears a direct decision even during a progress outage",async({page,shipping})=>{
  shipping.mode="drafts";shipping.outcome="confirmation";await shipping.open();shipping.jobsFail=true;
  await page.getByRole("button",{name:"Import to eBay",exact:true}).first().click();
  await expect(prompt(page)).toBeVisible();
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(prompt(page)).toHaveCount(0);
  expect(shipping.requests.filter(request=>request.method==="DELETE")).toHaveLength(1);
});
test("Drafts uses queued decision progress when the refresh is unavailable",async({page,shipping})=>{
  shipping.mode="drafts";shipping.jobs=[pending()];await shipping.open();shipping.jobsFail=true;
  await page.getByRole("button",{name:"Retry check",exact:true}).click();
  await expect(prompt(page)).toHaveCount(0);
  await expect(page.getByText("Queued for eBay",{exact:true})).toBeVisible();
  await expect(page.getByText("Shipping confirmation required",{exact:true})).toHaveCount(0);
});
