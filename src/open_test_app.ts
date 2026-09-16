import app from './test_role_bar';
import { platformMode } from './pilot_rules';
const TEST_ROUTES:Record<string,string>={customer:'/account',hauler:'/hauler',dispatcher:'/dispatcher',driver:'/driver',admin:'/admin'};
function cookie(req:Request,n:string){for(const p of (req.headers.get('Cookie')||'').split(';')){const [k,...v]=p.trim().split('=');if(k===n)return decodeURIComponent(v.join('='))}return null}
async function role(env:any){try{const x=await env.DB.prepare(`SELECT view_role FROM admin_test_context ORDER BY updated_at DESC LIMIT 1`).first<any>();return x?.view_role||'customer'}catch{return 'customer'}}
export default{async fetch(req:Request,env:any,ctx:ExecutionContext){const u=new URL(req.url),mode=await platformMode(env);if(mode?.mode==='testing'){
 // During owner QA, the root app opens directly into the selected test role.
 if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/login'))return Response.redirect(new URL(TEST_ROUTES[await role(env)]||'/account',req.url).toString(),302);
 // Keep real authentication APIs intact but do not force QA navigation through login screens.
 }
 return app.fetch(req,env,ctx)}};
