import app from "./admin_notifications";
import { transitionOrder } from "./order_lifecycle";
import { sendNotification } from "./notifications";

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function cookie(req:Request,n:string){for(const p of (req.headers.get("Cookie")||"").split(";")){const [k,...v]=p.trim().split("=");if(k===n)return decodeURIComponent(v.join("="))}return null}
async function sha(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function user(req:Request,env:any){const t=cookie(req,"woc_session");if(!t)return null;return env.DB.prepare(`SELECT users.id,users.email,users.role FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND datetime(sessions.expires_at)>datetime('now') LIMIT 1`).bind(await sha(t)).first<any>()}
async function driverContext(userId:string,env:any){return env.DB.prepare(`SELECT htm.hauler_id,htm.role FROM hauler_team_members htm JOIN hauler_profiles hp ON hp.user_id=htm.hauler_id WHERE htm.user_id=? AND htm.active=1 AND htm.role='driver' AND hp.status='approved' LIMIT 1`).bind(userId).first<any>()}

async function driverTransition(req:Request,env:any,orderId:string){
 const u=await user(req,env); if(!u)return json({error:"Please sign in again."},401);
 const driver=await driverContext(u.id,env); if(!driver)return json({error:"Driver access required."},403);
 const assigned=await env.DB.prepare(`SELECT order_id FROM driver_assignments WHERE order_id=? AND driver_user_id=? AND hauler_id=? LIMIT 1`).bind(orderId,u.id,driver.hauler_id).first();
 if(!assigned)return json({error:"That delivery is not assigned to you."},404);
 let body:any={};try{body=await req.json()}catch{}
 const next=String(body.status||"");
 if(!["en_route","delivered","completed"].includes(next))return json({error:"Invalid status."},400);
 const result=await transitionOrder(env,{orderId,toStatus:next,actorUserId:u.id,actorRole:"driver",eventType:"driver_status_changed",details:{hauler_id:driver.hauler_id}});
 if(!result.ok)return json({error:result.error},409);
 const order=await env.DB.prepare(`SELECT o.id,o.customer_id,o.gallons,cu.email,cu.phone,hp.business_name FROM orders o JOIN users cu ON cu.id=o.customer_id LEFT JOIN hauler_profiles hp ON hp.user_id=? WHERE o.id=? LIMIT 1`).bind(driver.hauler_id,orderId).first<any>();
 const label=next==="en_route"?"En Route":next==="delivered"?"Delivered":"Completed";
 const text=`Water OnCall: Your ${Number(order?.gallons||0).toLocaleString()} gallon delivery with ${String(order?.business_name||"your hauler")} is now ${label}. Sign in for details.`;
 if(order?.email)await sendNotification(env,{eventType:`order.${next}.customer_notification`,channel:"email",recipient:order.email,subject:`Water OnCall delivery update — ${label}`,html:`<div style="font-family:Arial,sans-serif;color:#13283d"><h2>Your Water OnCall delivery is ${label}</h2><p>${text}</p></div>`,orderId,userId:order.customer_id,metadata:{hauler_id:driver.hauler_id,status:next}});
 if(order?.phone)await sendNotification(env,{eventType:`order.${next}.customer_notification`,channel:"sms",recipient:order.phone,text,orderId,userId:order.customer_id,metadata:{hauler_id:driver.hauler_id,status:next}});
 return json({ok:true,status:result.toStatus});
}

export default{async fetch(req:Request,env:any,ctx:ExecutionContext){const url=new URL(req.url);const m=url.pathname.match(/^\/api\/driver\/orders\/([^/]+)\/status$/);if(m&&req.method==="POST")return driverTransition(req,env,decodeURIComponent(m[1]));return app.fetch(req,env,ctx)}};
