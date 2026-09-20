import app from "./finalize";
import authApp from "./router";
import {
  AddressValidationError,
  canonicalAddressFields,
  needsConfirmation,
  validateAddress,
  type ValidatedAddress,
} from "./address_validation";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

async function hasSession(request: Request, env: any): Promise<boolean> {
  const token = cookieValue(request, "woc_session");
  if (!token) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const row = await env.DB.prepare("SELECT 1 AS present FROM sessions WHERE token_hash=? AND datetime(expires_at)>datetime('now') LIMIT 1").bind(hash).first();
  return Boolean(row);
}

function addressError(error: unknown): Response {
  if (error instanceof AddressValidationError) {
    return json({ error: error.message, address: error.address }, error.status >= 400 && error.status < 600 ? error.status : 422);
  }
  return json({ error: "Address validation is temporarily unavailable. Please try again." }, 503);
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
  const js = String.raw`document.addEventListener("DOMContentLoaded",()=>{
    const endpoint="/api/address-validation";
    const hidden=(form,name)=>{let input=form.elements.namedItem(name);if(!(input instanceof HTMLInputElement)){input=document.createElement("input");input.type="hidden";input.name=name;form.append(input)}return input};
    const field=(form,name)=>{const input=form.elements.namedItem(name);return input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement?input:null};
    const component=(components,type)=>{const item=(components||[]).find((part)=>(part.types||[]).includes(type));return item?.longText||item?.shortText||""};
    const status=(form)=>{let item=form.querySelector(".google-address-status");if(!item){item=document.createElement("div");item.className="google-address-status";item.setAttribute("aria-live","polite");item.style.cssText="grid-column:1/-1;margin-top:8px;font-size:13px;font-weight:750;color:#61778d";form.querySelector(".fields")?.append(item)}return item};
    const show=(form,message,error=false)=>{const item=status(form);item.textContent=message;item.style.color=error?"#a32121":"#08764b"};
    const requestValidation=async(input)=>{const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(input)});const payload=await response.json().catch(()=>({}));if(!response.ok||!payload.data)throw new Error(payload.error||payload.data?.message||"Google could not validate this address.");return payload.data};
    const confirmAddress=(address,label)=>{if(address.action!=="confirm"&&address.action!=="add_subpremise")return true;return window.confirm("Use Google's standardized "+label+"?\n\n"+address.formatted_address)};
    const reset=(form)=>{form.dataset.addressValidated="";for(const name of ["address_validation_token","business_address_validation_token","address_confirmed","business_address_confirmed","private_fill_stations_confirmed"]){const input=field(form,name);if(input)input.value=""}};
    const autocompleteBox=(labelText,placeholder)=>{const box=document.createElement("div");box.className="field full google-address-search";box.style.cssText="padding:12px;border:1px solid #dce8f3;border-radius:12px;background:#f7fbfe";const label=document.createElement("label");label.textContent=labelText;const autocomplete=new google.maps.places.PlaceAutocompleteElement();autocomplete.placeholder=placeholder;autocomplete.includedRegionCodes=["ca"];autocomplete.style.cssText="display:block;width:100%;min-height:48px";box.append(label,autocomplete);return{box,autocomplete}};

    const orderForm=document.getElementById("order-form");
    if(orderForm){
      const names=["address_line1","address_line2","city","postal_code"];
      names.forEach((name)=>field(orderForm,name)?.addEventListener("input",()=>reset(orderForm)));
      const setup=async()=>{if(!window.google?.maps?.importLibrary)return;await google.maps.importLibrary("places");const street=field(orderForm,"address_line1");if(!street||orderForm.querySelector(".google-address-search"))return;const {box,autocomplete}=autocompleteBox("Find delivery address with Google","Start typing the delivery address");street.closest(".field")?.before(box);autocomplete.addEventListener("gmp-select",async(event)=>{try{const place=event.placePrediction.toPlace();await place.fetchFields({fields:["id","formattedAddress","addressComponents","location"]});const parts=place.addressComponents||[];street.value=[component(parts,"street_number"),component(parts,"route")].filter(Boolean).join(" ")||place.formattedAddress||"";const city=component(parts,"locality")||component(parts,"postal_town")||component(parts,"administrative_area_level_3")||component(parts,"sublocality");const postal=component(parts,"postal_code");if(field(orderForm,"city"))field(orderForm,"city").value=city;if(field(orderForm,"postal_code"))field(orderForm,"postal_code").value=postal.toUpperCase();hidden(orderForm,"formatted_address").value=place.formattedAddress||"";hidden(orderForm,"google_place_id").value=place.id||"";hidden(orderForm,"google_lat").value=place.location?String(place.location.lat()):"";hidden(orderForm,"google_lng").value=place.location?String(place.location.lng()):"";reset(orderForm);show(orderForm,"Address selected. Google will fully validate it when you submit.")}catch{show(orderForm,"Unable to read that address. Select it again or use the fields below.",true)}})};
      setup();
      orderForm.addEventListener("submit",async(event)=>{
        if(orderForm.dataset.addressValidated==="1")return;
        event.preventDefault();event.stopImmediatePropagation();
        const submitter=event.submitter;const oldText=submitter?.textContent||"";if(submitter){submitter.disabled=true;submitter.textContent="Validating address…"}
        try{
          let address=await requestValidation({address_line1:field(orderForm,"address_line1")?.value,address_line2:field(orderForm,"address_line2")?.value,city:field(orderForm,"city")?.value,province:"Ontario",postal_code:field(orderForm,"postal_code")?.value,country_code:"CA",formatted_address:field(orderForm,"formatted_address")?.value,latitude:field(orderForm,"google_lat")?.value,longitude:field(orderForm,"google_lng")?.value});
          if(address.action==="add_subpremise"&&!field(orderForm,"address_line2")?.value.trim()){const unit=window.prompt("Google found the building. Enter a unit or suite if one applies, or leave blank for a single-address property.");if(unit===null)throw new Error("Address confirmation was cancelled.");if(unit.trim()){field(orderForm,"address_line2").value=unit.trim();address=await requestValidation({...address,address_line2:unit.trim()})}}
          if(!confirmAddress(address,"delivery address"))throw new Error("Review the address fields and try again.");
          for(const name of ["address_line1","address_line2","city","postal_code"]){const input=field(orderForm,name);if(input&&address[name]!=null)input.value=address[name]}
          hidden(orderForm,"formatted_address").value=address.formatted_address||"";hidden(orderForm,"google_place_id").value=address.geocoding_place_id||"";hidden(orderForm,"google_lat").value=address.latitude==null?"":String(address.latitude);hidden(orderForm,"google_lng").value=address.longitude==null?"":String(address.longitude);hidden(orderForm,"address_validation_token").value=address.token||"";hidden(orderForm,"address_confirmed").value=(address.action==="confirm"||address.action==="add_subpremise")?"1":"0";
          orderForm.dataset.addressValidated="1";show(orderForm,address.validation_status==="accepted"?"✓ Delivery address validated by Google":"✓ Delivery address confirmed and marked for review");if(submitter){submitter.disabled=false;submitter.textContent=oldText}orderForm.requestSubmit(submitter||undefined);
        }catch(error){show(orderForm,error.message||"Unable to validate the delivery address.",true);if(submitter){submitter.disabled=false;submitter.textContent=oldText}}
      },true);
    }

    const haulerForm=document.getElementById("hauler-form");
    if(haulerForm){
      const business=field(haulerForm,"business_address");const privateStations=field(haulerForm,"private_fill_stations");
      business?.addEventListener("input",()=>reset(haulerForm));privateStations?.addEventListener("input",()=>reset(haulerForm));
      const setup=async()=>{if(!window.google?.maps?.importLibrary||!business)return;await google.maps.importLibrary("places");if(haulerForm.querySelector(".google-address-search"))return;const {box,autocomplete}=autocompleteBox("Find business address with Google","Start typing the business address");business.closest(".field")?.before(box);autocomplete.addEventListener("gmp-select",async(event)=>{try{const place=event.placePrediction.toPlace();await place.fetchFields({fields:["id","formattedAddress","addressComponents","location"]});const parts=place.addressComponents||[];const line1=[component(parts,"street_number"),component(parts,"route")].filter(Boolean).join(" ")||place.formattedAddress||"";business.value=place.formattedAddress||line1;hidden(haulerForm,"business_address_line1").value=line1;hidden(haulerForm,"business_city").value=component(parts,"locality")||component(parts,"postal_town")||component(parts,"administrative_area_level_3")||component(parts,"sublocality");hidden(haulerForm,"business_province").value=component(parts,"administrative_area_level_1")||"Ontario";hidden(haulerForm,"business_postal_code").value=component(parts,"postal_code").toUpperCase();hidden(haulerForm,"business_place_id").value=place.id||"";hidden(haulerForm,"business_lat").value=place.location?String(place.location.lat()):"";hidden(haulerForm,"business_lng").value=place.location?String(place.location.lng()):"";reset(haulerForm);show(haulerForm,"Business address selected. Google will fully validate it when you submit.")}catch{show(haulerForm,"Unable to read that address. Select it again or enter it manually.",true)}})};
      setup();
      haulerForm.addEventListener("submit",async(event)=>{
        if(haulerForm.dataset.addressValidated==="1")return;
        event.preventDefault();event.stopImmediatePropagation();
        const submitter=event.submitter;const oldText=submitter?.textContent||"";if(submitter){submitter.disabled=true;submitter.textContent="Validating addresses…"}
        try{
          let address=await requestValidation({address_line1:field(haulerForm,"business_address_line1")?.value,address_line2:field(haulerForm,"business_address_line2")?.value,city:field(haulerForm,"business_city")?.value,province:field(haulerForm,"business_province")?.value||"Ontario",postal_code:field(haulerForm,"business_postal_code")?.value,country_code:"CA",formatted_address:business?.value,latitude:field(haulerForm,"business_lat")?.value,longitude:field(haulerForm,"business_lng")?.value});
          if(address.action==="add_subpremise"&&!field(haulerForm,"business_address_line2")?.value){const unit=window.prompt("Google found the business building. Enter a unit or suite if one applies, or leave blank if none applies.");if(unit===null)throw new Error("Address confirmation was cancelled.");if(unit.trim()){hidden(haulerForm,"business_address_line2").value=unit.trim();address=await requestValidation({...address,address_line2:unit.trim()})}}
          if(!confirmAddress(address,"business address"))throw new Error("Review the business address and try again.");
          if(business)business.value=address.formatted_address;for(const [name,value] of Object.entries({business_address_line1:address.address_line1,business_address_line2:address.address_line2,business_city:address.city,business_province:address.province,business_postal_code:address.postal_code,business_place_id:address.geocoding_place_id,business_lat:address.latitude,business_lng:address.longitude,business_address_validation_token:address.token,business_address_confirmed:(address.action==="confirm"||address.action==="add_subpremise")?"1":"0"})){hidden(haulerForm,name).value=value==null?"":String(value)}
          const lines=(privateStations?.value||"").split(/\n|;/).map((line)=>line.trim()).filter(Boolean);if(lines.length>10)throw new Error("Enter no more than 10 private fill-station addresses.");
          if(lines.length){const validated=await Promise.all(lines.map((line)=>requestValidation({formatted_address:line,province:"Ontario",country_code:"CA"})));const review=validated.filter((item)=>item.action==="confirm"||item.action==="add_subpremise");if(review.length&&!window.confirm("Use Google's standardized private fill-station address"+(validated.length===1?"":"es")+"?\n\n"+validated.map((item)=>item.formatted_address).join("\n")))throw new Error("Review the private fill-station addresses and try again.");if(privateStations)privateStations.value=validated.map((item)=>item.formatted_address).join("\n");hidden(haulerForm,"private_fill_stations_confirmed").value="1"}
          haulerForm.dataset.addressValidated="1";show(haulerForm,"✓ Business and private fill-station addresses checked by Google");if(submitter){submitter.disabled=false;submitter.textContent=oldText}haulerForm.requestSubmit(submitter||undefined);
        }catch(error){show(haulerForm,error.message||"Unable to validate the addresses.",true);if(submitter){submitter.disabled=false;submitter.textContent=oldText}}
      },true);
    }
  });`;
  return new Response(js, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" } });
}

function allowGoogle(headers: Headers): void {
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' https://maps.googleapis.com https://maps.gstatic.com; connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com; img-src 'self' data: https://maps.googleapis.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
}

function injectAddressTools(html: string, key: string): string {
  if (html.includes("/customer-address.js")) return html;
  const maps = key ? `<script src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&libraries=places&v=weekly" defer></script>` : "";
  return html.replace("</body>", maps + '<script src="/customer-address.js" defer></script></body>');
}

async function validateOrderBody(body: any): Promise<{ body: any; address: ValidatedAddress }> {
  const address = await validateAddress({
    address_line1: body.address_line1,
    address_line2: body.address_line2,
    city: body.city,
    province: body.province || "Ontario",
    postal_code: body.postal_code,
    country_code: "CA",
    formatted_address: body.google_formatted_address || body.formatted_address,
    latitude: body.google_lat,
    longitude: body.google_lng,
  });
  if (address.action === "add_subpremise" && !String(body.address_line2 || "").trim() && !truthy(body.address_confirmed)) {
    throw new AddressValidationError("Add a unit or suite if one applies, or confirm that this is a single-address property.", 422, address);
  }
  if (needsConfirmation(address) && !truthy(body.address_confirmed)) {
    throw new AddressValidationError("Confirm Google's standardized delivery address before submitting.", 409, address);
  }
  return {
    address,
    body: { ...body, ...canonicalAddressFields(address), address_confirmed: truthy(body.address_confirmed) },
  };
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const key = String(env.GOOGLE_MAPS_BROWSER_KEY || "").trim();
    if (url.pathname === "/customer-address.js" && request.method === "GET") return customerAddressScript();
    if (url.pathname === "/api/address-validation" && request.method === "POST") {
      if (!await hasSession(request, env)) return json({ error: "Please sign in again." }, 401);
      try {
        const body = await request.json();
        return json({ data: await validateAddress(body as any) });
      } catch (error) {
        return addressError(error);
      }
    }
    if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/phone/")) return authApp.fetch(request, env, ctx);
    if (url.pathname === "/api/orders" && request.method === "POST" && request.headers.get("Content-Type")?.includes("application/json")) {
      if (!await hasSession(request, env)) return json({ error: "Please sign in again." }, 401);
      let parsed: { body: any; address: ValidatedAddress };
      try {
        const body = await request.clone().json();
        parsed = await validateOrderBody(body);
      } catch (error) {
        return addressError(error);
      }
      const headers = new Headers(request.headers);
      headers.delete("content-length");
      const forwarded = new Request(request, { body: JSON.stringify(parsed.body), headers });
      const response = await app.fetch(forwarded, env, ctx);
      if (response.ok && parsed.address.geocoding_place_id && parsed.address.latitude !== null && parsed.address.longitude !== null) {
        try {
          const data: any = await response.clone().json();
          const orderId = data?.order?.id;
          if (orderId) {
            await ensureAddressSchema(env);
            await env.DB.prepare("INSERT OR REPLACE INTO order_google_addresses (order_id,place_id,formatted_address,lat,lng) VALUES (?,?,?,?,?)")
              .bind(orderId, parsed.address.geocoding_place_id, parsed.address.formatted_address, parsed.address.latitude, parsed.address.longitude).run();
          }
        } catch {}
      }
      return response;
    }
    const response = await app.fetch(request, env, ctx);
    if ((url.pathname === "/account" || url.pathname === "/hauler") && request.method === "GET" && response.headers.get("Content-Type")?.includes("text/html")) {
      const html = injectAddressTools(await response.text(), key);
      const headers = new Headers(response.headers);
      headers.delete("Content-Length");
      headers.set("Cache-Control", "no-store");
      allowGoogle(headers);
      return new Response(html, { status: response.status, statusText: response.statusText, headers });
    }
    return response;
  },
};
