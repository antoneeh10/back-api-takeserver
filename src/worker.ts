export interface Env {
  // Tempat binding KV atau D1 jika ada di masa depan
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. Set CORS headers agar API bisa diakses dari frontend mana pun
    const corsHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Origin, X-Requested-With, Accept",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Parse slug dari path /api/:slug
    const match = pathname.match(/^\/api\/([a-zA-Z0-9_\-]+)/);
    if (!match) {
      if (pathname === "/api" || pathname === "/api/") {
        return new Response(JSON.stringify({
          status: "online",
          server: "takeServer-Cloudflare-Gateway",
          message: "Welcome to your public takeServer API gateway! Query any endpoint at /api/:slug"
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      return new Response(JSON.stringify({ error: "Not Found", message: "Use path /api/:slug to access endpoints." }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const slug = match[1];

    try {
      // 3. Ambil konfigurasi routing API dari Firestore REST API
      const projectId = "mytest-project-is-nownow";
      const databaseId = "ai-studio-takeserverapihub-1daf5fbc-d6be-4e23-a7b8-75108bfa6e67";
      const docUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/apis/${slug}`;
      
      const fsResponse = await fetch(docUrl);
      if (fsResponse.status === 404) {
        return new Response(JSON.stringify({
          error: "API Not Found",
          message: `The endpoint '${slug}' is not registered on your takeServer Hub.`
        }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const docData = await fsResponse.json() as any;
      const api = parseFirestoreFields(docData.fields);

      // 4. Validasi Status API (Enabled/Disabled)
      if (!api.enabled) {
        return new Response(JSON.stringify({
          error: "API Disabled",
          message: `The '${api.name || slug}' API is currently disabled.`
        }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // 5. Validasi HTTP Method yang diizinkan
      const requestMethod = request.method.toUpperCase();
      const allowedMethods = ((api.method as string[]) || ["GET"]).map(m => m.toUpperCase());
      if (!allowedMethods.includes(requestMethod)) {
        return new Response(JSON.stringify({
          error: "Method Not Allowed",
          message: `The '${api.name || slug}' API only supports: ${allowedMethods.join(', ')}.`
        }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // 6. Jalankan Analytics secara Asynchronous (Background task)
      ctx.waitUntil((async () => {
        try {
          await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents:commit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              writes: [
                {
                  transform: {
                    document: `projects/${projectId}/databases/${databaseId}/documents/apis/${slug}`,
                    fieldTransforms: [{ fieldPath: "requestsCount", increment: { integerValue: "1" } }]
                  }
                },
                {
                  transform: {
                    document: `projects/${projectId}/databases/${databaseId}/documents/settings/stats`,
                    fieldTransforms: [{ fieldPath: "requests", increment: { integerValue: "1" } }]
                  }
                }
              ]
            })
          });
        } catch (e) {
          console.error("Failed to update analytics:", e);
        }
      })());

      // 7. Proxy Fallback Mode (Meneruskan request ke target endpoint asli)
      let targetUrl = api.endpoint as string;
      if (!targetUrl) {
        return new Response(JSON.stringify({ error: "Misconfigured", message: "Target endpoint URL is missing in Firestore." }), {
          status: 502,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Ambil query params asli jika ada (?key=value)
      const searchStr = url.search;
      if (searchStr) {
        targetUrl += (targetUrl.includes('?') ? '&' : '?') + searchStr.substring(1);
      }

      // Bersihkan header bawaan Cloudflare agar tidak konflik dengan server tujuan
      const exclude = ['host', 'connection', 'cookie', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-real-ip'];
      const forwardHeaders = new Headers();
      for (const [k, v] of request.headers.entries()) {
        if (!exclude.includes(k.toLowerCase())) {
          forwardHeaders.set(k, v);
        }
      }

      // Tembakkan request ke server asli (Backend tujuan, VPS, atau API pihak ke-3)
      const proxyRes = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.arrayBuffer() : undefined
      });

      // Salin response headers dari target dan suntik CORS
      const finalHeaders = new Headers(proxyRes.headers);
      for (const [k, v] of Object.entries(corsHeaders)) {
        finalHeaders.set(k, v);
      }

      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: finalHeaders
      });

    } catch (err: any) {
      return new Response(JSON.stringify({
        error: "Gateway Execution Error",
        message: err.message
      }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};

// Helper untuk membersihkan struktur data dari REST API Firestore
function parseFirestoreFields(fields: any): Record<string, any> {
  const result: Record<string, any> = {};
  if (!fields) return result;
  
  for (const [key, value] of Object.entries(fields)) {
    const val = value as any;
    if (!val) continue;

    if ('stringValue' in val) {
      result[key] = val.stringValue;
    } else if ('booleanValue' in val) {
      result[key] = val.booleanValue;
    } else if ('integerValue' in val) {
      result[key] = parseInt(val.integerValue, 10);
    } else if ('doubleValue' in val) {
      result[key] = parseFloat(val.doubleValue);
    } else if ('arrayValue' in val) {
      const values = val.arrayValue.values || [];
      result[key] = values.map((v: any) => {
        if ('stringValue' in v) return v.stringValue;
        if ('booleanValue' in v) return v.booleanValue;
        return v;
      });
    } else if ('mapValue' in val) {
      result[key] = parseFirestoreFields(val.mapValue.fields);
    }
  }
  return result;
}
