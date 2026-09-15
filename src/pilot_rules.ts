import app from "./pilot_foundation";
import { ensurePilotSchema } from "./pilot_foundation";

export async function ensurePilotRulesSchema(env:any):Promise<void>{
 await ensurePilotSchema(env);
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS marketplace_offers(id TEXT PRIMARY KEY,order_id TEXT NOT NULL,hauler_id TEXT NOT NULL,offer_type TEXT NOT NULL CHECK(offer_type IN ('preferred','backup')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','expired','declined','cancelled')),offered_at TEXT NOT NULL DEFAULT(datetime('now')),expires_at TEXT,responded_at TEXT,UNIQUE(order_id,hauler_id),FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,FOREIGN KEY(hauler_id) REFERENCES users(id) ON DELETE CASCADE)`).run();
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS platform_mode(id INTEGER PRIMARY KEY CHECK(id=1),mode TEXT NOT NULL DEFAULT 'testing' CHECK(mode IN ('testing','live')),payments_enabled INTEGER NOT NULL DEFAULT 0,dispatch_enabled INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT(datetime('now')),updated_by TEXT)`).run();
 await env.DB.prepare(`INSERT OR IGNORE INTO platform_mode(id,mode,payments_enabled,dispatch_enabled) VALUES(1,'testing',0,0)`).run();
}
export async function platformMode(env:any){await ensurePilotRulesSchema(env);return env.DB.prepare(`SELECT mode,payments_enabled,dispatch_enabled,updated_at FROM platform_mode WHERE id=1`).first<any>()}
export function preferredOfferExpiry(from=new Date()):string{return new Date(from.getTime()+24*60*60*1000).toISOString()}
export async function eligibleHaulers(env:any,customerId:string):Promise<any[]>{
 await ensurePilotRulesSchema(env);
 const rows=await env.DB.prepare(`SELECT hp.user_id AS hauler_id,hp.business_name,COALESCE(chp.preference,'allowed') AS preference FROM hauler_profiles hp LEFT JOIN customer_hauler_preferences chp ON chp.hauler_id=hp.user_id AND chp.customer_id=? WHERE hp.status='approved' AND COALESCE(chp.preference,'allowed')<>'excluded' ORDER BY CASE COALESCE(chp.preference,'allowed') WHEN 'preferred' THEN 0 ELSE 1 END,hp.business_name`).bind(customerId).all();return rows.results||[];
}

function json(d:any,s=200){return new Response(JSON.stringify(d),{status:s,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
export default{async fetch(req:Request,env:any,ctx:ExecutionContext){const url=new URL(req.url);if(url.pathname==='/api/platform/mode'&&req.method==='GET')return json(await platformMode(env));return app.fetch(req,env,ctx)}};
