import "dotenv/config";
import { DELONGHI_REPAIR, runParentSkuRepair, type ParentSkuRepairCheckpoint } from "../lib/ebay-parent-sku-repair";
async function main() {
 const args=process.argv.slice(2);
 if(args.includes("--help")){console.log("Dry run: node --conditions=react-server --import tsx scripts/repair-delonghi-parent-sku.ts\nApply only after separate authorization: add --apply --authorize-remove-parent-304997589004");return;}
 if(args.some(a=>!["--apply","--authorize-remove-parent-304997589004"].includes(a)))throw new Error("Unknown repair option.");
 const [{prisma},{readEbayInventory},{getStoreNumber,callEbayReviseItem},{acquirePriceCheckResultLease}]=await Promise.all([import("../lib/prisma"),import("../lib/ebay-inventory-writer"),import("../lib/ebay"),import("../lib/price-check-result-application")]);
 const d=DELONGHI_REPAIR,requestKey="parent-sku-repair:v2:"+d.itemId;
 try {
  const p=await prisma.product.findFirst({where:{id:d.productId,storeId:d.storeId},include:{variants:true}});
  if(!p||p.ebayItemId!==d.itemId||p.asin!==d.sku||p.quantity!==0||p.variants.length!==1||p.variants[0].sku!==d.sku)throw new Error("Local De’Longhi identity or quantity changed. Stop for review.");
  const storeNumber=await getStoreNumber(d.storeId);
  const result=await runParentSkuRepair({storeId:d.storeId,apply:args.includes("--apply"),authorized:args.includes("--authorize-remove-parent-304997589004")},{
   read:()=>readEbayInventory(d.itemId,storeNumber),
   load:async()=>(await prisma.listingOperation.findUnique({where:{requestKey}}))?.preparedPayload as unknown as ParentSkuRepairCheckpoint??null,
   acquire:()=>acquirePriceCheckResultLease({storeId:d.storeId,productId:d.productId}),
   assertNoUnresolved:async()=>{
    const pending=await prisma.listingOperation.findFirst({where:{productId:d.productId,storeId:d.storeId,requestKey:{not:requestKey},stage:{in:["PREPARED","PRICE_SYNC","QUANTITY_SYNC","RECONCILIATION"]}}});
    const local=await prisma.product.findFirst({where:{id:d.productId,storeId:d.storeId},include:{variants:true}});
    if(pending||!local||local.ebayItemId!==d.itemId||local.asin!==d.sku||local.quantity!==0||local.holdGeneration!==p.holdGeneration||local.variants.length!==1||local.variants[0].sku!==d.sku)throw new Error("Unresolved operation or changed identity blocks repair.");
   },
   save:async checkpoint=>{const data={stage:checkpoint.state==="CONFIRMED"?"COMPLETED" as const:"RECONCILIATION" as const,preparedPayload:JSON.parse(JSON.stringify(checkpoint)),...(checkpoint.state==="CONFIRMED"?{completedAt:new Date(),ebayConfirmedAt:new Date()}:{})};await prisma.listingOperation.upsert({where:{requestKey},create:{requestKey,productId:d.productId,storeId:d.storeId,holdGeneration:p.holdGeneration,...data},update:data});},
   write:xml=>callEbayReviseItem(xml,storeNumber)
  });
  if(result.dryRun){const {mkdir,writeFile}=await import("node:fs/promises");const evidence=new URL("../scratch/delonghi-parent-sku-repair-preview.json",import.meta.url);await mkdir(new URL("./",evidence),{recursive:true});await writeFile(evidence,JSON.stringify(result,null,2));}
  console.log(JSON.stringify(result,null,2));
 }finally{await prisma.$disconnect();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Repair stopped.");process.exitCode=1;});
