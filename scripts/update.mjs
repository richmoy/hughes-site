// Updates status.json from news RSS feeds. Node 20+, no dependencies.
// Usage: node scripts/update.mjs            (live feeds)
//        node scripts/update.mjs --fixture sample.xml --today 2026-11-04   (offline test)
//
// Rules, in order of how much they matter:
//   1. signed becomes true ONLY when an official NHL.com item says Quinn Hughes signed with the Wild.
//   2. A trusted outlet reporting a deal as agreed or close sets a "not yet official" note. The answer stays NO.
//   3. Recent contract news from trusted outlets fills the news list (newest 8).
//   4. manual.json can force the answer either way, and always wins.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_PATH = path.join(ROOT, "status.json");
const MANUAL_PATH = path.join(ROOT, "manual.json");

const QUERIES = [
  '"Quinn Hughes" Wild contract extension',
  '"Quinn Hughes" Wild signs',
  '"Quinn Hughes" Guerin contract talks',
  '"Quinn Hughes" Wild trade',
];

// Hosts whose reporting we accept for the news list and the "close to a deal" note.
const TRUSTED = [
  "nhl.com", "tsn.ca", "sportsnet.ca", "espn.com", "theathletic.com", "nytimes.com",
  "dailyfaceoff.com", "thehockeynews.com", "startribune.com", "fox9.com", "kare11.com",
  "mprnews.org", "cbssports.com", "si.com", "yahoo.com", "thescore.com", "foxsports.com",
];
const OFFICIAL = ["nhl.com"]; // only these can flip the answer to YES

const NEWS_DAYS = 60;
const FLAG_DAYS = 7;
const MAX_ITEMS = 8;

const args = process.argv.slice(2);
const argVal = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const fixture = argVal("--fixture");
const now = argVal("--today") ? new Date(argVal("--today") + "T12:00:00Z") : new Date();

// ---------- helpers ----------
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .trim();

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1]) : "";
};

function parseItems(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const srcMatch = block.match(/<source\s+url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    const rawTitle = tag(block, "title");
    const sourceName = srcMatch ? decode(srcMatch[2]) : "";
    // Google News appends " - Source Name" to titles
    let title = rawTitle;
    if (sourceName && title.endsWith(" - " + sourceName)) title = title.slice(0, -(sourceName.length + 3));
    const pub = new Date(tag(block, "pubDate"));
    let host = "";
    try { host = new URL(srcMatch ? decode(srcMatch[1]) : "").hostname.replace(/^www\./, ""); } catch {}
    items.push({ title: title.trim(), link: tag(block, "link"), pub, host, source: sourceName });
  }
  return items.filter((i) => i.title && i.link && !isNaN(i.pub));
}

const hostMatches = (host, list) => list.some((h) => host === h || host.endsWith("." + h));
const daysOld = (d) => (now - d) / 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

const MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
function asOfString(d) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" })
    .formatToParts(d).reduce((o, x) => (o[x.type] = x.value, o), {});
  return `${MONTHS[+p.month - 1]} ${+p.day}, ${p.year}`;
}

// ---------- classification ----------
const aboutQuinn = (t) => /quinn hughes/i.test(t) && !/jack hughes|luke hughes/i.test(t.replace(/quinn hughes/gi, ""));
const aboutWild = (t) => /\bwild\b|minnesota/i.test(t);
const hasQuestion = (t) => t.includes("?");
const hedged = /\b(won'?t|not|no deal|nothing|far from|still|until|if|could|may|might|would|should|hopes?|wants?|rumou?rs?|speculation|denies|false)\b/i;

const SIGN_WORDS = /\b(signs?|signed|inks?|re-?signs?|agrees? to|agreed to)\b/i;
const DEAL_WORDS = /\b(extension|contract|deal|years?|\$\d)/i;
const CLOSE_WORDS = /\b(agree[sd]?|agreement|close to|nearing|nears|set to sign|expected to sign|finalizing|reach(?:es|ed)?|imminent)\b/i;
const NEWS_WORDS = /(contract|extension|re-?sign|sign|free agen|ufa|guerin|leipold|agent|negotiat|trade|cap hit|makar)/i;

function isOfficialSigning(i) {
  return hostMatches(i.host, OFFICIAL) && aboutQuinn(i.title) && aboutWild(i.title) &&
    SIGN_WORDS.test(i.title) && DEAL_WORDS.test(i.title) && !hasQuestion(i.title) && !hedged.test(i.title) &&
    daysOld(i.pub) <= 14;
}
function isCloseReport(i) {
  return hostMatches(i.host, TRUSTED) && aboutQuinn(i.title) && aboutWild(i.title) &&
    CLOSE_WORDS.test(i.title) && DEAL_WORDS.test(i.title) && !hasQuestion(i.title) && !hedged.test(i.title) &&
    daysOld(i.pub) <= FLAG_DAYS;
}
function isNews(i) {
  return hostMatches(i.host, TRUSTED) && aboutQuinn(i.title) && aboutWild(i.title) && !hasQuestion(i.title) &&
    NEWS_WORDS.test(i.title) && daysOld(i.pub) <= NEWS_DAYS && daysOld(i.pub) >= -1;
}

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const clip = (t) => (t.length > 140 ? t.slice(0, 137).trimEnd() + "..." : t);

// ---------- fetching ----------
async function loadItems() {
  if (fixture) return parseItems(fs.readFileSync(fixture, "utf8"));
  const all = [];
  let ok = 0;
  for (const q of QUERIES) {
    const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" + encodeURIComponent(q + " when:60d");
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; hughes-status-bot)" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      all.push(...parseItems(await res.text()));
      ok++;
    } catch (e) {
      console.warn(`feed failed for ${q}: ${e.message}`);
    }
  }
  if (ok === 0) { console.error("All feeds failed. Leaving status.json unchanged."); process.exit(1); }
  return all;
}

// ---------- main ----------
const read = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };
const status = read(STATUS_PATH, { signed: false, asOf: "", summary: "", flag: "", flagUrl: "", reports: [] });
const manual = read(MANUAL_PATH, { signed: null, summary: "", blockedUrls: [] });
const blocked = new Set(Array.isArray(manual.blockedUrls) ? manual.blockedUrls : []);
const before = JSON.stringify(status);

const items = (await loadItems()).filter((i) => !blocked.has(i.link));
const next = { ...status, reports: Array.isArray(status.reports) ? status.reports : [] };

// 1 and 2: signing status and the "close" note
if (manual.signed === true) {
  next.signed = true; next.summary = manual.summary || status.summary || "He signed."; next.flag = ""; next.flagUrl = "";
} else if (manual.signed === false) {
  next.signed = false; next.summary = "";
} else if (!status.signed) {
  const signing = items.filter(isOfficialSigning).sort((a, b) => b.pub - a.pub)[0];
  if (signing) {
    next.signed = true; next.summary = clip(signing.title); next.flag = ""; next.flagUrl = "";
    console.log("SIGNING DETECTED:", signing.title, signing.link);
  } else {
    const close = items.filter(isCloseReport).sort((a, b) => b.pub - a.pub)[0];
    next.flag = close ? "Reports of a deal, not yet official." : "";
    next.flagUrl = close ? close.link : "";
  }
}

// 3: news list
const seen = new Set(next.reports.map((r) => norm(r.text)));
const urls = new Set(next.reports.map((r) => r.url));
for (const i of items.filter(isNews).sort((a, b) => b.pub - a.pub)) {
  if (urls.has(i.link) || seen.has(norm(clip(i.title)))) continue;
  next.reports.push({ date: iso(i.pub), text: clip(i.title), source: i.source || i.host, url: i.link });
  seen.add(norm(clip(i.title))); urls.add(i.link);
}
next.reports = next.reports
  .filter((r) => r && r.date && r.text && !blocked.has(r.url))
  .sort((a, b) => (a.date === b.date ? (a.url < b.url ? -1 : 1) : a.date < b.date ? 1 : -1))
  .slice(0, MAX_ITEMS);

// Date only, so the file changes (and the site redeploys) at most once a day unless something real changes.
next.asOf = asOfString(now);

const after = JSON.stringify(next);
if (after !== before) {
  fs.writeFileSync(STATUS_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log("status.json updated");
} else {
  console.log("no changes");
}
