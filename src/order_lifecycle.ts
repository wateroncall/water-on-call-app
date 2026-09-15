export const ORDER_STATES=["requested","offered","accepted","assigned","en_route","delivered","completed","cancelled"] as const;
export type OrderState=typeof ORDER_STATES[number];

const TRANSITIONS:Record<OrderState,OrderState[]>={
 requested:["offered","cancelled"],
 offered:["accepted","cancelled"],
 accepted:["assigned","en_route","cancelled"],
 assigned:["en_route","cancelled"],
 en_route:["delivered"],
 delivered:["completed"],
 completed:[],
 cancelled:[]
};

export function canTransition(from:string,to:string):boolean{
 return (TRANSITIONS[from as OrderState]||[]).includes(to as OrderState);
}

export async function ensureOrderAuditSchema(env:any):Promise<void>{
 await env.DB.prepare(`CREATE TABLE IF NOT EXISTS order_activity_log(
   id TEXT PRIMARY KEY,
   order_id TEXT NOT NULL,
   event_type TEXT NOT NULL,
   from_status TEXT,
   to_status TEXT,
   actor_user_id TEXT,
   actor_role TEXT,
   details_json TEXT,
   created_at TEXT NOT NULL DEFAULT(datetime('now')),
   FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
 )`).run();
 await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_order_activity_order ON order_activity_log(order_id,created_at DESC)`).run();
}

export async function recordOrderActivity(env:any,input:{orderId:string;eventType:string;fromStatus?:string|null;toStatus?:string|null;actorUserId?:string|null;actorRole?:string|null;details?:Record<string,unknown>}):Promise<void>{
 await ensureOrderAuditSchema(env);
 await env.DB.prepare(`INSERT INTO order_activity_log(id,order_id,event_type,from_status,to_status,actor_user_id,actor_role,details_json) VALUES(?,?,?,?,?,?,?,?)`)
  .bind(crypto.randomUUID(),input.orderId,input.eventType,input.fromStatus||null,input.toStatus||null,input.actorUserId||null,input.actorRole||null,JSON.stringify(input.details||{})).run();
}

export async function transitionOrder(env:any,input:{orderId:string;toStatus:string;actorUserId?:string|null;actorRole?:string|null;eventType?:string;details?:Record<string,unknown>}):Promise<{ok:boolean;fromStatus?:string;toStatus?:string;error?:string}>{
 const row=await env.DB.prepare(`SELECT id,status FROM orders WHERE id=? LIMIT 1`).bind(input.orderId).first<any>();
 if(!row)return {ok:false,error:"Order not found."};
 const from=String(row.status||"");
 const to=String(input.toStatus||"");
 if(!canTransition(from,to))return {ok:false,fromStatus:from,toStatus:to,error:`Order cannot move from ${from} to ${to}.`};
 const changed=await env.DB.prepare(`UPDATE orders SET status=?,updated_at=datetime('now') WHERE id=? AND status=?`).bind(to,input.orderId,from).run();
 if(Number(changed.meta?.changes||0)!==1)return {ok:false,error:"The order changed before this update. Refresh and try again."};
 await recordOrderActivity(env,{orderId:input.orderId,eventType:input.eventType||"status_changed",fromStatus:from,toStatus:to,actorUserId:input.actorUserId,actorRole:input.actorRole,details:input.details});
 return {ok:true,fromStatus:from,toStatus:to};
}

export async function recentOrderActivity(env:any,orderId:string,limit=100):Promise<any[]>{
 await ensureOrderAuditSchema(env);
 const safe=Math.max(1,Math.min(250,Number(limit)||100));
 const rows=await env.DB.prepare(`SELECT id,order_id,event_type,from_status,to_status,actor_user_id,actor_role,details_json,created_at FROM order_activity_log WHERE order_id=? ORDER BY created_at DESC LIMIT ?`).bind(orderId,safe).all();
 return rows.results||[];
}
