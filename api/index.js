// api/index.js

import { URL } from "url";

// FIREBASE_URL Render-এর এনভায়রনমেন্ট ভেরিয়েবল থেকে আসবে
const FIREBASE_URL = process.env.FIREBASE_URL;

// ----------------- Main Handler -----------------

export default async function handler(request, response) {
  // request.headers.host সঠিকভাবে URL তৈরি করতে সাহায্য করে
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const origin = request.headers.origin || "*";

  // CORS Preflight হ্যান্ডলিং
  if (request.method === "OPTIONS") {
    return sendCors(response, origin);
  }

  const key = url.searchParams.get("key") || "default";
  const uniqueMode = url.searchParams.get("unique") === "1";
  
  // IP Address নির্ণয় (Render এর জন্য 'x-real-ip' বা 'x-forwarded-for' ব্যবহার করে)
  const ip = request.headers["x-real-ip"] ||
             request.headers["x-forwarded-for"] ||
             "0.0.0.0";

  if (url.pathname.startsWith("/api/get")) {
    const data = await getCountsFirebase(key);
    return sendJSON(response, data, origin);
  }

  if (url.pathname.startsWith("/api/hit")) {
    
    let uniqueInc = 1;
    if (uniqueMode) {
      const day = new Date().toISOString().slice(0, 10);
      const ipKey = `unique/${key}/${day}/${ip}.json`;

      const exists = await firebaseGet(ipKey);
      if (exists) uniqueInc = 0;
      else await firebasePut(ipKey, true);
    }

    const totalPath = `counters/${key}/total.json`;
    const uniquePath = `counters/${key}/unique.json`;
    const updatedPath = `counters/${key}/updated_at.json`; 

    const totalValue = (await firebaseGet(totalPath)) || 0;
    const uniqueValue = (await firebaseGet(uniquePath)) || 0;

    const newTotal = totalValue + 1;
    const newUnique = uniqueValue + uniqueInc;

    await firebasePut(totalPath, newTotal);
    await firebasePut(uniquePath, newUnique);
    await firebasePut(updatedPath, new Date().toISOString());

    const data = await getCountsFirebase(key);
    return sendJSON(response, data, origin);
  }

  // রুট হ্যান্ডলিং
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end("Hit Counter API (Firebase + Render) ✔");
}


// ----------------- Firebase Helpers -----------------

async function firebaseGet(path) {
  const res = await fetch(FIREBASE_URL + path);
  if (!res.ok) return null;
  const text = await res.text();
  // Firebase-এ ডেটা না থাকলে response টেক্সট "null" আসে
  return text === 'null' ? null : JSON.parse(text);
}

async function firebasePut(path, value) {
  await fetch(FIREBASE_URL + path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

async function getCountsFirebase(key) {
  const base = `counters/${key}/`;
  const total = (await firebaseGet(base + "total.json")) || 0;
  const unique = (await firebaseGet(base + "unique.json")) || 0;
  const updated = await firebaseGet(base + "updated_at.json");

  return {
    key,
    total,
    unique,
    total_formatted: formatNum(total),
    unique_formatted: formatNum(unique),
    updated_at: updated || null,
  };
}


// ---------------- Utils (Node.js/Polka Compatible) ----------------

// Node.js এর response অবজেক্ট ব্যবহার করে CORS হেডার সেট করা
function sendCors(response, origin) {
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  response.writeHead(204, headers); 
  response.end();
}

// JSON ডেটা পাঠানো
function sendJSON(response, data, origin) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
  };
  response.writeHead(200, headers);
  response.end(JSON.stringify(data));
}

function formatNum(n) {
  if (n < 1000) return n.toString();
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  if (n < 1000000) return Math.round(n / 1000) + "k";
  return (n / 1000000).toFixed(1) + "m";
}
