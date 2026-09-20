import app from "./validation";
import {
  AddressValidationError,
  needsConfirmation,
  validateAddress,
  type ValidatedAddress,
} from "./address_validation";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function addressError(error: unknown): Response {
  if (error instanceof AddressValidationError) return json({ error: error.message, address: error.address }, error.status);
  return json({ error: "Address validation is temporarily unavailable. Please try again." }, 503);
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sessionUser(request: Request, env: any): Promise<any | null> {
  const token = cookieValue(request, "woc_session");
  if (!token) return null;
  const hash = await sha256(token);
  return env.DB.prepare(`SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND datetime(sessions.expires_at)>datetime('now') LIMIT 1`).bind(hash).first();
}

async function ensureSchema(env: any): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS hauler_business_details (
    hauler_id TEXT PRIMARY KEY,
    business_phone TEXT,
    business_address TEXT,
    business_place_id TEXT,
    business_lat REAL,
    business_lng REAL,
    private_fill_stations TEXT,
    water_stations_json TEXT NOT NULL DEFAULT '[]',
    other_services TEXT,
    business_hours TEXT,
    custom_truck_capacity_gallons INTEGER,
    vehicle_insurance_provider TEXT,
    vehicle_insurance_expiry TEXT,
    liability_insurance_provider TEXT,
    liability_insurance_expiry TEXT,
    damage_responsibility_ack INTEGER NOT NULL DEFAULT 0,
    damage_responsibility_ack_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hauler_id) REFERENCES users(id) ON DELETE CASCADE
  )`).run();
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}

const STATIONS = [
  ["smithville","Smithville — 6253 London Rd, Smithville, ON L0R 2A0"],
  ["pelham","Pelham municipal bulk water station — Fonthill, ON"],
  ["pc_elm","Port Colborne Elm St — 1080 Elm St, Port Colborne, ON"],
  ["pc_elizabeth","Port Colborne Elizabeth St bulk water station — Elizabeth St, Port Colborne, ON"],
  ["nf_stanley","Niagara Falls Municipal Service Centre — 3200 Stanley Ave, Niagara Falls, ON"],
  ["nf_chippawa","Niagara Falls Chippawa/Stanley station — Chippawa Pkwy at Stanley Ave, Niagara Falls, ON"]
];

function applicationEnhancementScript(): Response {
  const js = `document.addEventListener('DOMContentLoaded',()=>{
    const form=document.getElementById('hauler-form'); if(!form)return;
    const cap=document.getElementById('truck_capacity_gallons'); const custom=document.getElementById('custom-cap-wrap');
    if(cap&&custom){cap.addEventListener('change',()=>{custom.hidden=cap.value!=='other';const i=custom.querySelector('input');if(i)i.required=cap.value==='other'});}
    const address=document.getElementById('business_address'); const place=document.getElementById('business_place_id');
    if(address&&place){address.addEventListener('input',()=>{if(address.dataset.confirmed!==address.value){place.value='';address.dataset.confirmed='';}});}
    form.addEventListener('submit',(e)=>{
      const phone=form.querySelector('[name=business_phone]');
      if(phone&&phone.value.replace(/\\D/g,'').length<10){e.preventDefault();phone.setCustomValidity('Enter a valid business phone number.');phone.reportValidity();return;} if(phone)phone.setCustomValidity('');
      const addr=form.querySelector('[name=business_address]');
      if(addr&&!addr.value.trim()){e.preventDefault();addr.setCustomValidity('Enter the business address.');addr.reportValidity();return;} if(addr)addr.setCustomValidity('');
      const ack=form.querySelector('[name=damage_responsibility_ack]');
      if(ack&&!ack.checked){e.preventDefault();ack.setCustomValidity('You must acknowledge responsibility for damage before submitting.');ack.reportValidity();return;} if(ack)ack.setCustomValidity('');
    },true);
  });`;
  return new Response(js,{headers:{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store"}});
}

async function enhanceHauler(html: string, request: Request, env: any): Promise<string> {
  if (!html.includes('id="hauler-form"') || html.includes('name="business_phone"')) return html;
  const user = await sessionUser(request, env);
  let details:any = null;
  if (user) { await ensureSchema(env); details = await env.DB.prepare("SELECT * FROM hauler_business_details WHERE hauler_id=?").bind(user.id).first(); }
  const selected = (()=>{ try{return new Set(JSON.parse(details?.water_stations_json||'[]'));}catch{return new Set<string>();} })();
  const stations = STATIONS.map(([value,label])=>`<label style="display:flex;gap:9px;align-items:flex-start;margin:8px 0;font-weight:650"><input type="checkbox" name="water_station_${value}" value="1" ${selected.has(value)?'checked':''} style="width:auto;height:auto;margin-top:3px"> <span>${escapeHtml(label)}</span></label>`).join('');
  const extra = [
    '<div class="field"><label for="business_phone">Business phone number</label><input id="business_phone" name="business_phone" type="tel" autocomplete="tel" maxlength="30" value="'+escapeHtml(details?.business_phone)+'" placeholder="905-555-1234" required></div>',
    '<div class="field full"><label for="business_address">Business address</label><input id="business_address" name="business_address" autocomplete="street-address" maxlength="500" value="'+escapeHtml(details?.business_address)+'" placeholder="Start typing your business address" required><input id="business_place_id" name="business_place_id" type="hidden" value="'+escapeHtml(details?.business_place_id)+'"><input name="business_lat" type="hidden" value="'+escapeHtml(details?.business_lat)+'"><input name="business_lng" type="hidden" value="'+escapeHtml(details?.business_lng)+'"><small style="color:#61778d">Select a Google suggestion when available, or enter the complete address. It is validated when you submit.</small></div>',
    '<div class="field full"><label>Water fill stations used</label><div style="border:1px solid #dce8f3;border-radius:11px;padding:12px">'+stations+'</div></div>',
    '<div class="field full"><label for="private_fill_stations">Private fill station address(es)</label><textarea id="private_fill_stations" name="private_fill_stations" maxlength="2000" placeholder="Enter one complete private fill-station address per line.">'+escapeHtml(details?.private_fill_stations)+'</textarea><small style="color:#61778d">Up to 10 addresses. Each address is checked with Google.</small></div>',
    '<div class="field full"><label for="other_services">Other services offered</label><textarea id="other_services" name="other_services" maxlength="600" placeholder="Pool fills, hot tubs, dust control, construction, emergency delivery, etc.">'+escapeHtml(details?.other_services)+'</textarea></div>',
    '<div class="field full"><label for="business_hours">Normal business hours</label><textarea id="business_hours" name="business_hours" maxlength="500" placeholder="Example: Mon–Fri 7:00 AM–6:00 PM; Sat 8:00 AM–3:00 PM; Sun closed">'+escapeHtml(details?.business_hours)+'</textarea></div>',
    '<div class="field"><label for="vehicle_insurance_provider">Vehicle insurance provider / policy</label><input id="vehicle_insurance_provider" name="vehicle_insurance_provider" maxlength="150" value="'+escapeHtml(details?.vehicle_insurance_provider)+'"></div>',
    '<div class="field"><label for="vehicle_insurance_expiry">Vehicle insurance expiry</label><input id="vehicle_insurance_expiry" name="vehicle_insurance_expiry" type="date" value="'+escapeHtml(details?.vehicle_insurance_expiry)+'"></div>',
    '<div class="field"><label for="liability_insurance_provider">Liability insurance provider / policy</label><input id="liability_insurance_provider" name="liability_insurance_provider" maxlength="150" value="'+escapeHtml(details?.liability_insurance_provider)+'"></div>',
    '<div class="field"><label for="liability_insurance_expiry">Liability insurance expiry</label><input id="liability_insurance_expiry" name="liability_insurance_expiry" type="date" value="'+escapeHtml(details?.liability_insurance_expiry)+'"></div>',
    '<div class="field full"><label style="display:flex;gap:9px;align-items:flex-start"><input name="damage_responsibility_ack" type="checkbox" value="1" '+(details?.damage_responsibility_ack?'checked':'')+' style="width:auto;height:auto;margin-top:3px" required><span>I acknowledge that the water hauler is responsible for damage caused by its vehicles, equipment, drivers or delivery operations, subject to applicable law and the Water OnCall hauler agreement.</span></label></div>'
  ].join('');
  html = html.replace('<div class="field full"><label for="service_areas">Service areas</label>', extra+'<div class="field full"><label for="service_areas">Service areas</label>');
  html = html.replace('<div class="field"><label for="truck_count">Number of trucks</label><input id="truck_count" name="truck_count" type="number" min="1" max="100" value="1" required></div>', '<div class="field"><label for="truck_count">Number of trucks</label><select id="truck_count" name="truck_count" required>'+Array.from({length:20},(_,i)=>'<option value="'+(i+1)+'">'+(i+1)+'</option>').join('')+'<option value="25">21–25</option><option value="50">26–50</option><option value="100">50+</option></select></div>');
  html = html.replace('<option value="3000">3,000 gallons</option></select>', '<option value="3000">3,000 gallons</option><option value="other">Other capacity</option></select></div><div id="custom-cap-wrap" class="field" hidden><label for="custom_truck_capacity_gallons">Other truck capacity (gallons)</label><input id="custom_truck_capacity_gallons" name="custom_truck_capacity_gallons" type="number" min="500" max="10000" step="50" placeholder="Example: 3400"></div>');
  html = html.replace('<div class="field"><label for="insurance_expiry">Insurance expiry</label><input id="insurance_expiry" name="insurance_expiry" type="date" value=""></div>', '');
  html = html.replace('</body>','<script src="/hauler-application-v2.js" defer></script></body>');
  return html;
}

async function saveExtraDetails(request: Request, env: any, body: any): Promise<void> {
  const user = await sessionUser(request, env); if(!user) return;
  await ensureSchema(env);
  const stations = STATIONS.filter(([v])=>body['water_station_'+v]).map(([v])=>v);
  const custom = body.custom_truck_capacity_gallons ? Math.round(Number(body.custom_truck_capacity_gallons)) : null;
  const ack = body.damage_responsibility_ack ? 1 : 0;
  await env.DB.prepare(`INSERT INTO hauler_business_details
    (hauler_id,business_phone,business_address,business_place_id,business_lat,business_lng,private_fill_stations,water_stations_json,other_services,business_hours,custom_truck_capacity_gallons,vehicle_insurance_provider,vehicle_insurance_expiry,liability_insurance_provider,liability_insurance_expiry,damage_responsibility_ack,damage_responsibility_ack_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?=1 THEN datetime('now') ELSE NULL END,datetime('now'))
    ON CONFLICT(hauler_id) DO UPDATE SET business_phone=excluded.business_phone,business_address=excluded.business_address,business_place_id=excluded.business_place_id,business_lat=excluded.business_lat,business_lng=excluded.business_lng,private_fill_stations=excluded.private_fill_stations,water_stations_json=excluded.water_stations_json,other_services=excluded.other_services,business_hours=excluded.business_hours,custom_truck_capacity_gallons=excluded.custom_truck_capacity_gallons,vehicle_insurance_provider=excluded.vehicle_insurance_provider,vehicle_insurance_expiry=excluded.vehicle_insurance_expiry,liability_insurance_provider=excluded.liability_insurance_provider,liability_insurance_expiry=excluded.liability_insurance_expiry,damage_responsibility_ack=excluded.damage_responsibility_ack,damage_responsibility_ack_at=CASE WHEN excluded.damage_responsibility_ack=1 THEN datetime('now') ELSE damage_responsibility_ack_at END,updated_at=datetime('now')`)
    .bind(user.id,String(body.business_phone||''),String(body.business_address||''),String(body.business_place_id||'')||null,Number(body.business_lat)||null,Number(body.business_lng)||null,String(body.private_fill_stations||'')||null,JSON.stringify(stations),String(body.other_services||'')||null,String(body.business_hours||'')||null,Number.isFinite(custom as any)?custom:null,String(body.vehicle_insurance_provider||'')||null,String(body.vehicle_insurance_expiry||'')||null,String(body.liability_insurance_provider||'')||null,String(body.liability_insurance_expiry||'')||null,ack,ack).run();
  if(custom && custom>=500 && custom<=10000) await env.DB.prepare("UPDATE hauler_profiles SET truck_capacity_gallons=?,updated_at=datetime('now') WHERE user_id=?").bind(custom,user.id).run();
}

function privateStationLines(value: unknown): string[] {
  return String(value ?? "").split(/\n|;/).map((line) => line.trim()).filter(Boolean);
}

async function validateHaulerAddresses(body: any): Promise<{ body: any; business: ValidatedAddress; privateStations: ValidatedAddress[] }> {
  const business = await validateAddress({
    address_line1: body.business_address_line1,
    address_line2: body.business_address_line2,
    city: body.business_city,
    province: body.business_province || "Ontario",
    postal_code: body.business_postal_code,
    country_code: "CA",
    formatted_address: body.business_address,
    latitude: body.business_lat,
    longitude: body.business_lng,
  });
  if (needsConfirmation(business) && !truthy(body.business_address_confirmed)) {
    throw new AddressValidationError("Confirm Google's standardized business address before submitting.", 409, business);
  }

  const lines = privateStationLines(body.private_fill_stations);
  if (lines.length > 10) throw new AddressValidationError("Enter no more than 10 private fill-station addresses.", 422);
  const privateStations = await Promise.all(lines.map((formattedAddress) => validateAddress({
    formatted_address: formattedAddress,
    province: "Ontario",
    country_code: "CA",
  })));
  if (privateStations.some(needsConfirmation) && !truthy(body.private_fill_stations_confirmed)) {
    throw new AddressValidationError("Confirm Google's standardized private fill-station addresses before submitting.", 409);
  }

  const structuredStations = privateStations.map((address) => ({
    label: null,
    address_line1: address.address_line1,
    address_line2: address.address_line2,
    city: address.city,
    province: address.province,
    postal_code: address.postal_code,
    formatted_address: address.formatted_address,
    address_validation_token: address.token,
    address_confirmed: needsConfirmation(address),
  }));

  return {
    business,
    privateStations,
    body: {
      ...body,
      business_address: business.formatted_address,
      business_address_line1: business.address_line1,
      business_address_line2: business.address_line2,
      business_city: business.city,
      business_province: business.province,
      business_postal_code: business.postal_code,
      business_place_id: business.geocoding_place_id,
      business_lat: business.latitude,
      business_lng: business.longitude,
      business_address_validation_token: business.token,
      business_address_confirmed: needsConfirmation(business),
      private_fill_stations: privateStations.map((address) => address.formatted_address).join("\n"),
      private_fill_station_addresses: structuredStations,
    },
  };
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if(url.pathname==='/hauler-application-v2.js' && request.method==='GET') return applicationEnhancementScript();
    if(url.pathname==='/api/hauler/application' && request.method==='POST' && request.headers.get('Content-Type')?.includes('application/json')){
      if (!await sessionUser(request, env)) return json({ error: 'Please sign in again.' }, 401);
      let body:any={}; try{body=await request.clone().json()}catch{}
      if(!body.business_phone || String(body.business_phone).replace(/\D/g,'').length<10) return new Response(JSON.stringify({error:'Enter a valid business phone number.'}),{status:400,headers:{'Content-Type':'application/json'}});
      if(!String(body.business_address||'').trim()) return new Response(JSON.stringify({error:'Enter the business address.'}),{status:400,headers:{'Content-Type':'application/json'}});
      if(!body.damage_responsibility_ack) return new Response(JSON.stringify({error:'Acknowledge the hauler damage-responsibility requirement before submitting.'}),{status:400,headers:{'Content-Type':'application/json'}});
      const originalCapacity=body.truck_capacity_gallons;
      if(originalCapacity==='other'){
        const c=Math.round(Number(body.custom_truck_capacity_gallons));
        if(!Number.isFinite(c)||c<500||c>10000) return new Response(JSON.stringify({error:'Enter a valid truck capacity between 500 and 10,000 gallons.'}),{status:400,headers:{'Content-Type':'application/json'}});
        body.truck_capacity_gallons=3000;
      }
      try {
        body = (await validateHaulerAddresses(body)).body;
      } catch (error) {
        return addressError(error);
      }
      const headers=new Headers(request.headers);
      headers.delete('content-length');
      const forwarded=new Request(request,{body:JSON.stringify(body),headers});
      const response=await app.fetch(forwarded,env,ctx);
      if(response.ok) await saveExtraDetails(request,env,{...body,truck_capacity_gallons:originalCapacity});
      return response;
    }
    const response=await app.fetch(request,env,ctx);
    if(url.pathname==='/hauler' && request.method==='GET' && response.headers.get('Content-Type')?.includes('text/html')){
      const html=await enhanceHauler(await response.text(),request,env); const h=new Headers(response.headers);h.delete('Content-Length');h.set('Cache-Control','no-store');return new Response(html,{status:response.status,statusText:response.statusText,headers:h});
    }
    return response;
  }
};
