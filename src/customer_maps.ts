import app from "./finalize";
import authApp from "./router";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

async function ensureAddressSchema(env: any): Promise<void> {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS order_google_addresses (
    order_id TEXT PRIMARY KEY,
    place_id TEXT NOT NULL,
    formatted_address TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`).run();
}

function customerAddressScript(): Response {
  const js = `document.addEventListener('DOMContentLoaded',async()=>{
    const form=document.getElementById('order-form');
    const street=document.getElementById('address_line1');
    const city=document.getElementById('city');
    const postal=document.getElementById('postal_code');
    if(!form||!street||!city||!postal||!window.google?.maps)return;
    const streetWrap=street.closest('.field'); const cityWrap=city.closest('.field'); const postalWrap=postal.closest('.field');
    if(streetWrap)streetWrap.style.display='none'; if(cityWrap)cityWrap.style.display='none'; if(postalWrap)postalWrap.style.display='none';
    const wrap=document.createElement('div'); wrap.className='field full';
    const label=document.createElement('label'); label.textContent='Delivery address';
    const help=document.createElement('small'); help.textContent='Start typing, then select your address from Google to confirm the delivery location.'; help.style.cssText='display:block;margin-top:7px;color:#61778d;line-height:1.4';
    const verified=document.createElement('div'); verified.id='google-address-status'; verified.style.cssText='margin-top:8px;font-size:13px;font-weight:700;color:#61778d'; verified.textContent='Address not yet confirmed';
    const {PlaceAutocompleteElement}=await google.maps.importLibrary('places');
    const autocomplete=new PlaceAutocompleteElement(); autocomplete.placeholder='Start typing your delivery address'; autocomplete.includedRegionCodes=['ca']; autocomplete.style.cssText='display:block;width:100%;min-height:48px';
    wrap.append(label,autocomplete,help,verified); streetWrap?.parentNode?.insertBefore(wrap,streetWrap);
    const hidden=(name)=>{let el=form.querySelector('[name="'+name+'"]');if(!el){el=document.createElement('input');el.type='hidden';el.name=name;form.append(el)}return el};
    const placeId=hidden('google_place_id'), lat=hidden('google_lat'), lng=hidden('google_lng'), formatted=hidden('google_formatted_address');
    const component=(components,type)=>{const c=(components||[]).find(x=>(x.types||[]).includes(type));return c?.longText||c?.shortText||''};
    const clear=()=>{placeId.value='';lat.value='';lng.value='';formatted.value='';verified.textContent='Address not yet confirmed';verified.style.color='#a32121'};
    autocomplete.addEventListener('input',clear);
    autocomplete.addEventListener('gmp-select',async(event)=>{try{const place=event.placePrediction.toPlace();await place.fetchFields({fields:['id','formattedAddress','addressComponents','location']});const comps=place.addressComponents||[];const number=component(comps,'street_number');const route=component(comps,'route');const town=component(comps,'locality')||component(comps,'postal_town')||component(comps,'administrative_area_level_3')||component(comps,'sublocality');const code=component(comps,'postal_code');if(!place.id||!place.location||!place.formattedAddress||!code){clear();verified.textContent='Please choose a complete Canadian street address.';return}street.value=[number,route].filter(Boolean).join(' ')||place.formattedAddress;city.value=town||'Ontario';postal.value=code.toUpperCase();placeId.value=place.id;lat.value=String(place.location.lat());lng.value=String(place.location.lng());formatted.value=place.formattedAddress;verified.textContent='✓ Google-confirmed address: '+place.formattedAddress;verified.style.color='#08764b'}catch(e){clear();verified.textContent='Unable to confirm that address. Please select it again.'}});
    form.addEventListener('submit',(e)=>{if(!placeId.value){e.preventDefault();e.stopImmediatePropagation();verified.textContent='Please select your delivery address from the Google suggestions before submitting.';verified.style.color='#a32121';autocomplete.focus()}},true);
  });`;
  return new Response(js,{headers:{"Content-Type":"text/javascript; charset=utf-8","Cache-Control":"no-store"}});
}

function allowGoogle(headers: Headers): void {
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com; img-src 'self' data: https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function injectMaps(html: string, key: string): string {
  if(html.includes('/customer-address.js')) return html;
  const tag='<script src="https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&loading=async&libraries=places&v=weekly" defer></script><script src="/customer-address.js" defer></script>';
  return html.replace('</body>',tag+'</body>');
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url=new URL(request.url);
    const key=String(env.GOOGLE_MAPS_BROWSER_KEY||'').trim();
    if(url.pathname==='/customer-address.js'&&request.method==='GET') return customerAddressScript();

    if(url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/phone/')) {
      return authApp.fetch(request, env, ctx);
    }

    if(url.pathname==='/api/orders'&&request.method==='POST'&&key&&request.headers.get('Content-Type')?.includes('application/json')){
      let body:any={};try{body=await request.clone().json()}catch{}
      if(!body.google_place_id||!body.google_formatted_address||!Number.isFinite(Number(body.google_lat))||!Number.isFinite(Number(body.google_lng))){return json({error:'Please select and confirm your delivery address from the Google suggestions.'},400)}
      const headers=new Headers(request.headers);headers.delete('content-length');
      const forwarded=new Request(request,{body:JSON.stringify(body),headers});
      const response=await app.fetch(forwarded,env,ctx);
      if(response.ok){try{const data:any=await response.clone().json();const orderId=data?.order?.id;if(orderId){await ensureAddressSchema(env);await env.DB.prepare(`INSERT OR REPLACE INTO order_google_addresses (order_id,place_id,formatted_address,lat,lng) VALUES (?,?,?,?,?)`).bind(orderId,String(body.google_place_id),String(body.google_formatted_address),Number(body.google_lat),Number(body.google_lng)).run()}}catch{}}
      return response;
    }

    const response=await app.fetch(request,env,ctx);
    if(key&&url.pathname==='/account'&&request.method==='GET'&&response.headers.get('Content-Type')?.includes('text/html')){
      const html=injectMaps(await response.text(),key); const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');allowGoogle(headers);return new Response(html,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
  }
};
