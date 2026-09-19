import app from "./lifecycle_api";
import { transitionOrder } from "./order_lifecycle";
import { sendNotification } from "./notifications";

function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}})}
function cookie(req:Request,n:string){for(const p of (req.headers.get("Cookie")||"").split(";")){const [k,...v]=p.trim().split("=");if(k===n)return decodeURIComponent(v.join("="))}return null}
async function sha(v:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function user(req:Request,env:any){const t=cookie(req,"woc_session");if(!t)return null;return env.DB.prepare(`SELECT users.id,users.email,users.role,users.full_name FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND datetime(sessions.expires_at)>datetime('now') LIMIT 1`).bind(await sha(t)).first<any>()}

const labels:Record<string,string>={en_route:"En Route",delivered:"Delivered",completed:"Completed"};
async function customerStatusNotification(env:any,order:any,hauler:any,status:string){
 if(!order.customer_email&&!order.customer_phone)return;
 const label=labels[status]||status;
 const html=`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#13283d;line-height:1.6"><h2 style="color:#06325e">Your Water OnCall delivery is ${label}</h2><p>Your delivery status has been updated.</p><p><strong>Delivery:</strong> ${Number(order.gallons||0).toLocaleString()} gallons<br><strong>Area:</strong> ${String(order.city||"")}<br><strong>Hauler:</strong> ${String(hauler.business_name||"Water OnCall hauler")}</p><p>Sign in to your Customer Portal for the latest details.</p></div>`;
 if(order.customer_email)await sendNotification(env,{eventType:`order.${status}.customer_notification`,channel:"email",recipient:order.customer_email,subject:`Water OnCall delivery update — ${label}`,html,orderId:order.id,userId:order.customer_id,metadata:{hauler_id:hauler.id,status}});
 if(order.customer_phone)await sendNotification(env,{eventType:`order.${status}.customer_notification`,channel:"sms",recipient:order.customer_phone,text:`Water OnCall: Your ${Number(order.gallons||0).toLocaleString()} gallon delivery with ${String(hauler.business_name||"your hauler")} is now ${label}. Sign in for details.`,orderId:order.id,userId:order.customer_id,metadata:{hauler_id:hauler.id,status}});
}

async function haulerTransition(req:Request,env:any,orderId:string){
 const u=await user(req,env);if(!u)return json({error:"Please sign in again."},401);
 const hauler=await env.DB.prepare(`SELECT hp.user_id AS id,hp.business_name,hp.status FROM hauler_profiles hp WHERE hp.user_id=? AND hp.status='approved' LIMIT 1`).bind(u.id).first<any>();
 if(!hauler)return json({error:"Approved hauler access required."},403);
 const order=await env.DB.prepare(`SELECT o.id,o.status,o.customer_id,o.gallons,o.city,cu.email AS customer_email,cu.phone AS customer_phone FROM order_assignments a JOIN orders o ON o.id=a.order_id JOIN users cu ON cu.id=o.customer_id WHERE a.order_id=? AND a.hauler_id=? LIMIT 1`).bind(orderId,u.id).first<any>();
 if(!order)return json({error:"That delivery is not assigned to this hauler."},404);
 let body:any={};try{body=await req.json()}catch{}
 const next=String(body.status||"");if(!["en_route","delivered","completed"].includes(next))return json({error:"Invalid status."},400);
 const result=await transitionOrder(env,{orderId,toStatus:next,actorUserId:u.id,actorRole:"hauler",eventType:"hauler_status_changed",details:{hauler_id:u.id}});
 if(!result.ok)return json({error:result.error},409);
 // Notification failure is logged but does not roll back a valid operational status update.
 await customerStatusNotification(env,{...order,status:result.toStatus},hauler,next);
 return json({ok:true,status:result.toStatus});
}

export default{async fetch(req:Request,env:any,ctx:ExecutionContext){const url=new URL(req.url);const m=url.pathname.match(/^\/api\/hauler\/deliveries\/([^/]+)\/status$/);if(m&&req.method==="POST")return haulerTransition(req,env,decodeURIComponent(m[1]));return app.fetch(req,env,ctx)}};
