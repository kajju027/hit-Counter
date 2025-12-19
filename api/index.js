import { URL } from "url";

const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_SECRET_TOKEN = process.env.FIREBASE_SECRET_TOKEN;

function formatNum(n) {
  if (n < 1000) return n.toString();
  if (n < 1000000) {
    const kValue = n / 1000;
    return (kValue % 1 === 0 ? kValue : kValue.toFixed(2)) + "K";
  }
  const mValue = n / 1000000;
  return (mValue % 1 === 0 ? mValue : mValue.toFixed(2)) + "M";
}

async function firebaseFetch(path, method = "GET", body = null) {
  const url = `${FIREBASE_DATABASE_URL.replace(/\/$/, "")}/${path}.json?auth=${FIREBASE_SECRET_TOKEN}`;
  const options = { 
    method, 
    headers: { "Content-Type": "application/json" } 
  };
  if (body) options.body = JSON.stringify(body);
  
  const res = await fetch(url, options);
  if (!res.ok) return null;
  const text = await res.text();
  return text === "null" ? null : JSON.parse(text);
}

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const origin = req.headers.origin || "*";
  const key = url.searchParams.get("key") || "default";
  
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store, no-cache, must-revalidate"
  };

  if (req.method === "OPTIONS") {
    res.writeHead(204, headers);
    return res.end();
  }

  const ip = req.headers["x-real-ip"] || req.headers["x-forwarded-for"]?.split(',')[0].trim() || "0.0.0.0";
  const safeIp = ip.replace(/\./g, "_");

  if (url.pathname.includes("/api/get")) {
    const data = await firebaseFetch(`counters/${key}`);
    const result = {
      key,
      total: data?.total || 0,
      unique: data?.unique || 0,
      total_formatted: formatNum(data?.total || 0),
      unique_formatted: formatNum(data?.unique || 0),
      updated_at: data?.updated_at || null
    };
    res.writeHead(200, headers);
    return res.end(JSON.stringify(result));
  }

  if (url.pathname.includes("/api/hit")) {
    const uniquePath = `unique_logs/${key}/${safeIp}`;
    const isKnown = await firebaseFetch(uniquePath);
    let uniqueInc = 0;
    
    if (!isKnown) {
      uniqueInc = 1;
      await firebaseFetch(uniquePath, "PUT", true);
    }

    const current = await firebaseFetch(`counters/${key}`) || { total: 0, unique: 0 };
    const updated = {
      total: (current.total || 0) + 1,
      unique: (current.unique || 0) + uniqueInc,
      updated_at: new Date().toISOString()
    };

    await firebaseFetch(`counters/${key}`, "PUT", updated);

    res.writeHead(200, headers);
    return res.end(JSON.stringify({
      key,
      ...updated,
      total_formatted: formatNum(updated.total),
      unique_formatted: formatNum(updated.unique)
    }));
  }

  res.writeHead(404, headers);
  res.end(JSON.stringify({ error: "Invalid Path" }));
}

