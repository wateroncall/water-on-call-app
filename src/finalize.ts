import app from "./hauler_application";

function tuneOperations(html: string): string {
  html = html.replace('Included distance (km)','Base distance included from fill station (km)');
  html = html.replace('name="included_hose_ft" type="number" value="50"','name="included_hose_ft" type="number" value="25"');
  html = html.replace('Extra per 50 ft hose (CAD)','Extra per additional 25 ft hose (CAD)');
  html = html.replace('<div class="field"><label>Commercial hourly rate (CAD)</label><input name="commercial_hourly" type="number" step="0.01"></div>','<input name="commercial_hourly" type="hidden" value="">');
  html = html.replace('Pricing, team, stations and dispatch settings.','Pricing, fill stations, team and dispatch settings. Base delivery distance is measured from the fill station.');
  return html;
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const response = await app.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/operations' && response.headers.get('Content-Type')?.includes('text/html')) {
      const html = tuneOperations(await response.text());
      const headers = new Headers(response.headers); headers.delete('Content-Length'); headers.set('Cache-Control','no-store');
      return new Response(html,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
  }
};
