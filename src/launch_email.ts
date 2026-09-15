import app from "./launch";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = "Water OnCall <info@wateroncall.ca>";
const NOTIFY = "info@wateroncall.ca";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendEmail(env: any, payload: Record<string, unknown>): Promise<{ok:boolean; status:number; detail:string}> {
  if (!env.RESEND_API_KEY) return {ok:false,status:500,detail:"RESEND_API_KEY is missing"};
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const detail = await response.text();
    if (!response.ok) console.error("Launch email failed", response.status, detail);
    return {ok:response.ok,status:response.status,detail};
  } catch (error:any) {
    const detail=String(error?.message||error||"Unknown email error");
    console.error("Launch email exception",detail);
    return {ok:false,status:500,detail};
  }
}

function customerPayload(body:any){
  const name=String(body?.full_name??"").trim();
  const email=String(body?.email??"").trim().toLowerCase();
  const firstName=name.split(/\s+/)[0]||"there";
  return {
    from:FROM,
    to:[email],
    subject:"You’re on the Water OnCall launch list",
    html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#13283d;line-height:1.6"><h1 style="color:#06325e">Welcome to Water OnCall, ${esc(firstName)}!</h1><p>Thanks for joining the Water OnCall launch list.</p><p>We’re building a simpler way to request bulk water delivery from approved local water haulers.</p><p>We’ll email you when Water OnCall ordering becomes available in your area.</p><p style="margin-top:28px"><strong>Water OnCall</strong><br>Bulk water delivery. A simpler way.</p></div>`
  };
}

function adminPayload(body:any){
  const name=String(body?.full_name??"").trim();
  const email=String(body?.email??"").trim().toLowerCase();
  return {
    from:FROM,
    to:[NOTIFY],
    subject:`New Water OnCall launch-list signup — ${name||email}`,
    html:`<div style="font-family:Arial,sans-serif;color:#13283d;line-height:1.6"><h2>New customer joined the launch list</h2><p><strong>Name:</strong> ${esc(name)}</p><p><strong>Email:</strong> ${esc(email)}</p><p><strong>Phone:</strong> ${esc(body?.phone||"Not provided")}</p><p><strong>Postal code / community:</strong> ${esc(body?.postal_code||"Not provided")}</p><p><strong>Water need:</strong> ${esc(String(body?.water_need||"Not provided").replace(/_/g," "))}</p><p><strong>Currently uses a water hauler:</strong> ${body?.current_hauler?"Yes":"No"}</p></div>`
  };
}

export default {
  async fetch(request:Request,env:any,ctx:ExecutionContext):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/api/launch/waitlist"){
      let body:any=null;
      try{body=await request.clone().json()}catch{}
      const response=await app.fetch(request,env,ctx);
      if(!response.ok||!body)return response;

      // Send the customer confirmation synchronously so a rejected Resend request is visible
      // during testing instead of being hidden in a background task.
      const customer=await sendEmail(env,customerPayload(body));
      ctx.waitUntil(sendEmail(env,adminPayload(body)));
      if(!customer.ok){
        let reason=customer.detail;
        try{const parsed=JSON.parse(customer.detail);reason=parsed?.message||parsed?.name||customer.detail}catch{}
        return new Response(JSON.stringify({error:`Signup saved, but customer confirmation email failed: ${reason}`}),{status:502,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
      }
      return response;
    }
    return app.fetch(request,env,ctx);
  }
};
