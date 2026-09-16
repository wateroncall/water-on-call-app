// Consolidated active entrypoint.
// Keep established customer Maps + operations tuning in the chain, then apply the
// newer pilot/testing/admin/security layers once on top.
import legacyIntegrated from './customer_maps';
import modern from './admin_test_tools';

// Routes owned by the modern pilot stack must go through it. All established
// application routes first remain available through the legacy integrated stack.
const MODERN_PREFIXES=['/admin/testing','/admin-testing.js','/api/admin/test-role','/admin/pilot-controls','/api/admin/pilot-controls','/admin/notifications','/api/admin/','/customer/haulers','/api/customer/hauler-preferences','/hauler/setup','/api/hauler/pricing-v2','/api/hauler/water-stations','/api/platform/'];
function modernRoute(path:string){return MODERN_PREFIXES.some(p=>path===p||path.startsWith(p))}
export default{async fetch(req:Request,env:any,ctx:ExecutionContext){const u=new URL(req.url);if(modernRoute(u.pathname))return modern.fetch(req,env,ctx);return legacyIntegrated.fetch(req,env,ctx)}};
