const RESEND_EMAILS = "https://api.resend.com/emails";
const DEFAULT_FROM = "Water OnCall <info@wateroncall.ca>";

export type NotificationChannel = "email" | "sms";
export type NotificationStatus = "pending" | "sent" | "failed";

export interface NotificationInput {
  eventType: string;
  channel: NotificationChannel;
  recipient: string;
  subject?: string;
  html?: string;
  orderId?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function ensureNotificationSchema(env: any): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS notification_log(
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    recipient TEXT NOT NULL,
    subject TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT,
    provider_message_id TEXT,
    error_message TEXT,
    order_id TEXT,
    user_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT(datetime('now')),
    sent_at TEXT
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_notification_log_order ON notification_log(order_id,created_at DESC)`).run();
}

async function createLog(env:any,input:NotificationInput):Promise<string>{
  await ensureNotificationSchema(env);
  const id=crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO notification_log(id,event_type,channel,recipient,subject,status,provider,order_id,user_id,metadata_json) VALUES(?,?,?,?,?,'pending',?,?,?,?)`)
    .bind(id,input.eventType,input.channel,input.recipient,input.subject||null,input.channel==='email'?'resend':'twilio',input.orderId||null,input.userId||null,JSON.stringify(input.metadata||{})).run();
  return id;
}

export async function sendNotification(env:any,input:NotificationInput):Promise<{ok:boolean;logId:string;error?:string}>{
  const logId=await createLog(env,input);
  if(input.channel!=="email"){
    const error="SMS notification transport is not connected to the central notification service yet.";
    await env.DB.prepare(`UPDATE notification_log SET status='failed',error_message=? WHERE id=?`).bind(error,logId).run();
    return {ok:false,logId,error};
  }
  if(!env.RESEND_API_KEY){
    const error="RESEND_API_KEY is missing";
    await env.DB.prepare(`UPDATE notification_log SET status='failed',error_message=? WHERE id=?`).bind(error,logId).run();
    return {ok:false,logId,error};
  }
  try{
    const response=await fetch(RESEND_EMAILS,{method:"POST",headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:DEFAULT_FROM,to:[input.recipient],subject:input.subject||"Water OnCall notification",html:input.html||""})});
    const text=await response.text();
    let data:any={}; try{data=JSON.parse(text)}catch{}
    if(!response.ok){
      const error=String(data?.message||text||`Resend returned ${response.status}`);
      await env.DB.prepare(`UPDATE notification_log SET status='failed',error_message=? WHERE id=?`).bind(error,logId).run();
      return {ok:false,logId,error};
    }
    await env.DB.prepare(`UPDATE notification_log SET status='sent',provider_message_id=?,sent_at=datetime('now') WHERE id=?`).bind(data?.id||null,logId).run();
    return {ok:true,logId};
  }catch(err:any){
    const error=String(err?.message||err||"Unknown notification error");
    await env.DB.prepare(`UPDATE notification_log SET status='failed',error_message=? WHERE id=?`).bind(error,logId).run();
    return {ok:false,logId,error};
  }
}

export async function recentNotifications(env:any,limit=100):Promise<any[]>{
  await ensureNotificationSchema(env);
  const safe=Math.max(1,Math.min(250,Number(limit)||100));
  const rows=await env.DB.prepare(`SELECT id,event_type,channel,recipient,subject,status,provider,provider_message_id,error_message,order_id,user_id,created_at,sent_at FROM notification_log ORDER BY created_at DESC LIMIT ?`).bind(safe).all();
  return rows.results||[];
}
