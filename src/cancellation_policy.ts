import app from './admin_override';
export type CancellationDecision={allowed:boolean;charge_cents:number;requires_admin:boolean;reason:string};
export function cancellationDecision(status:string,requestedDate:string|null,now=new Date(),serviceFeeCents=599):CancellationDecision{
 if(['requested','offered'].includes(status))return {allowed:true,charge_cents:0,requires_admin:false,reason:'Order has not been accepted.'};
 if(!['accepted','assigned'].includes(status))return {allowed:false,charge_cents:0,requires_admin:true,reason:'This delivery can no longer be cancelled automatically.'};
 if(!requestedDate)return {allowed:false,charge_cents:0,requires_admin:true,reason:'Delivery date is unavailable; Admin review is required.'};
 const delivery=new Date(requestedDate+'T00:00:00');const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());const hours=(delivery.getTime()-today.getTime())/3600000;
 if(hours>24)return {allowed:true,charge_cents:0,requires_admin:false,reason:'More than 24 hours before delivery.'};
 if(hours===24)return {allowed:true,charge_cents:serviceFeeCents,requires_admin:false,reason:'Cancellation is within 24 hours of delivery.'};
 // Same-day cancellation policy intentionally remains open for owner review.
 return {allowed:false,charge_cents:0,requires_admin:true,reason:'Same-day cancellation requires Water OnCall review.'};
}
export default app;
