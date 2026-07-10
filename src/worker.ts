export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Set CORS headers to allow requests from anywhere
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Origin, X-Requested-With, Accept",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Parse slug from path /api/:slug
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
      // Fetch API configuration from Firebase Firestore via REST API
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

      const docData = await fsResponse.json();
      const api = parseFirestoreFields(docData.fields);

      if (!api.enabled) {
        return new Response(JSON.stringify({
          error: "API Disabled",
          message: `The '${api.name}' API is currently disabled.`
        }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Check method matches allowed methods
      const requestMethod = request.method.toUpperCase();
      const allowedMethods = (api.method || ["GET"]).map(m => m.toUpperCase());
      if (!allowedMethods.includes(requestMethod)) {
        return new Response(JSON.stringify({
          error: "Method Not Allowed",
          message: `The '${api.name}' API only supports: ${allowedMethods.join(', ')}.`
        }), {
          status: 405,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      // Track request analytics asynchronously
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

      // Execute custom JS code
      if (api.code) {
        const isWorkerCode = api.code.includes('export default') || api.code.includes('async fetch') || api.code.includes('Response(');
        if (isWorkerCode) {
          let processedCode = api.code;
          if (processedCode.includes('export default')) {
            processedCode = processedCode.replace(/export\s+default\s+/, 'return ');
          } else {
            processedCode = `return {\n  async fetch(request, env, ctx) {\n    ${processedCode}\n  }\n}`;
          }

          const workerModule = new Function(processedCode)();
          const subResponse = await workerModule.fetch(request, env, ctx);
          
          const resHeaders = new Headers(subResponse.headers);
          for (const [k, v] of Object.entries(corsHeaders)) {
            resHeaders.set(k, v);
          }
          
          return new Response(subResponse.body, {
            status: subResponse.status,
            statusText: subResponse.statusText,
            headers: resHeaders
          });
        } else {
          let responseBody = null;
          let responseStatus = 200;
          const dummyHeaders = new Headers(corsHeaders);
          
          const res = {
            status(code) { responseStatus = code; return this; },
            json(body) { responseBody = JSON.stringify(body); dummyHeaders.set("Content-Type", "application/json"); },
            send(body) { responseBody = typeof body === "object" ? JSON.stringify(body) : String(body); }
          };

          const executor = new Function('req', 'res', 'fetch', `
            return (async () => {
              ${api.code}
            })();
          `);

          await executor(request, res, fetch);

          return new Response(responseBody || JSON.stringify({ status: "success", message: "Code executed." }), {
            status: responseStatus,
            headers: dummyHeaders
          });
        }
      }

      // Proxy fallback mode
      let targetUrl = api.endpoint;
      const searchStr = url.search;
      if (searchStr) {
        targetUrl += (targetUrl.includes('?') ? '&' : '?') + searchStr.substring(1);
      }

      const exclude = ['host', 'connection', 'cookie', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-real-ip'];
      const forwardHeaders = new Headers();
      for (const [k, v] of request.headers.entries()) {
        if (!exclude.includes(k.toLowerCase())) {
          forwardHeaders.set(k, v);
        }
      }

      const proxyRes = await fetch(targetUrl, {
        method: request.method,
        headers: forwardHeaders,
        body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.arrayBuffer() : undefined
      });

      const finalHeaders = new Headers(proxyRes.headers);
      for (const [k, v] of Object.entries(corsHeaders)) {
        finalHeaders.set(k, v);
      }

      return new Response(proxyRes.body, {
        status: proxyRes.status,
        headers: finalHeaders
      });

    } catch (err) {
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

function parseFirestoreFields(fields: any) {
  const result: any = {};
  if (!fields) return result;
  for (const [key, value] of Object.entries(fields) as any) {
    if ('stringValue' in value) {
      result[key] = value.stringValue;
    } else if ('booleanValue' in value) {
      result[key] = value.booleanValue;
    } else if ('integerValue' in value) {
      result[key] = parseInt(value.integerValue, 10);
    } else if ('doubleValue' in value) {
      result[key] = parseFloat(value.doubleValue);
    } else if ('arrayValue' in value) {
      const values = value.arrayValue.values || [];
      result[key] = values.map((v: any) => {
        if ('stringValue' in v) return v.stringValue;
        if ('booleanValue' in v) return v.booleanValue;
        return v;
      });
    } else if ('mapValue' in value) {
      result[key] = parseFirestoreFields(value.mapValue.fields);
    }
  }
  return result;
}
