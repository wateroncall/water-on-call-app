export interface PricingInput{
 basePriceCents:number;
 distanceKm:number;
 includedKm:number;
 extraDistanceBlockKm?:number;
 extraDistanceBlockCents:number;
 hoseDistanceFt:number;
 includedHoseFt:number;
 extraHoseBlockFt?:number;
 extraHoseBlockCents:number;
 serviceFeeCents:number;
}
export interface PriceBreakdown{
 base_price_cents:number;
 distance_surcharge_cents:number;
 hose_surcharge_cents:number;
 hauler_price_cents:number;
 service_fee_cents:number;
 customer_total_cents:number;
 hauler_payout_cents:number;
 distance_blocks:number;
 hose_blocks:number;
}
const money=(n:any)=>Math.max(0,Math.round(Number(n)||0));
const qty=(n:any)=>Math.max(0,Number(n)||0);
export function calculatePrice(i:PricingInput):PriceBreakdown{
 const base=money(i.basePriceCents),fee=money(i.serviceFeeCents);
 const distanceBlock=Math.max(.1,qty(i.extraDistanceBlockKm||5));
 const hoseBlock=Math.max(1,qty(i.extraHoseBlockFt||25));
 const extraKm=Math.max(0,qty(i.distanceKm)-qty(i.includedKm));
 const extraFt=Math.max(0,qty(i.hoseDistanceFt)-qty(i.includedHoseFt));
 const distanceBlocks=extraKm>0?Math.ceil(extraKm/distanceBlock):0;
 const hoseBlocks=extraFt>0?Math.ceil(extraFt/hoseBlock):0;
 const distance=distanceBlocks*money(i.extraDistanceBlockCents);
 const hose=hoseBlocks*money(i.extraHoseBlockCents);
 const hauler=base+distance+hose;
 return {base_price_cents:base,distance_surcharge_cents:distance,hose_surcharge_cents:hose,hauler_price_cents:hauler,service_fee_cents:fee,customer_total_cents:hauler+fee,hauler_payout_cents:hauler,distance_blocks:distanceBlocks,hose_blocks:hoseBlocks};
}

export async function ensurePricingSnapshotSchema(env:any):Promise<void>{
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS order_pricing_snapshots(
  order_id TEXT PRIMARY KEY,
  hauler_id TEXT,
  base_price_cents INTEGER NOT NULL,
  distance_surcharge_cents INTEGER NOT NULL DEFAULT 0,
  hose_surcharge_cents INTEGER NOT NULL DEFAULT 0,
  hauler_price_cents INTEGER NOT NULL,
  service_fee_cents INTEGER NOT NULL DEFAULT 0,
  customer_total_cents INTEGER NOT NULL,
  hauler_payout_cents INTEGER NOT NULL,
  distance_km REAL,
  included_km REAL,
  hose_distance_ft REAL,
  included_hose_ft REAL,
  pricing_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL DEFAULT(datetime('now')),
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
 )`).run();
}
export async function savePricingSnapshot(env:any,orderId:string,haulerId:string|null,input:PricingInput,price=calculatePrice(input)):Promise<PriceBreakdown>{
 await ensurePricingSnapshotSchema(env);
 await env.DB.prepare(`INSERT INTO order_pricing_snapshots(order_id,hauler_id,base_price_cents,distance_surcharge_cents,hose_surcharge_cents,hauler_price_cents,service_fee_cents,customer_total_cents,hauler_payout_cents,distance_km,included_km,hose_distance_ft,included_hose_ft,pricing_version)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'v1') ON CONFLICT(order_id) DO NOTHING`).bind(orderId,haulerId,price.base_price_cents,price.distance_surcharge_cents,price.hose_surcharge_cents,price.hauler_price_cents,price.service_fee_cents,price.customer_total_cents,price.hauler_payout_cents,qty(input.distanceKm),qty(input.includedKm),qty(input.hoseDistanceFt),qty(input.includedHoseFt)).run();
 return price;
}
