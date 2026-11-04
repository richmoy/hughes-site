# Did Hughes Sign?

A static page (`index.html`) that answers whether Quinn Hughes has signed with the Minnesota Wild, with a countdown to free agency on July 1, 2027. A GitHub Action rewrites `status.json` every 3 hours from news feeds, and Netlify or Vercel redeploys on each commit.

## Set up (about 10 minutes)

1. Create a new GitHub repo and push this folder to it.
2. Connect the repo to Netlify or Vercel.
   - Framework: none. Build command: empty. Publish/output directory: `.` (the repo root).
3. In the GitHub repo, open Settings > Actions > General > Workflow permissions and choose "Read and write permissions".
4. Open the Actions tab, pick "Update Hughes status" and click "Run workflow" once to test it.
5. Add your custom domain in the Netlify or Vercel settings.

## How the status is decided

`scripts/update.mjs` reads Google News RSS searches and applies these rules:

- **YES** only when an NHL.com item, published in the last 14 days, says Quinn Hughes signed with the Wild. Questions and hedged headlines ("could", "won't", "if") never count.
- **"Reports of a deal, not yet official" note** when a trusted outlet (TSN, Sportsnet, ESPN, The Athletic, Daily Faceoff, and similar) reports a deal as agreed or close in the last 7 days. The answer stays NO.
- **News list** gets recent contract headlines from trusted outlets, newest 8, linked to the source.
- If every feed fails, the script exits with an error and leaves `status.json` alone. GitHub emails you when a run fails.

The trusted outlets, keywords and time windows are constants at the top of `scripts/update.mjs`.

## Overriding by hand

Edit `manual.json` and commit it. It always wins.

```json
{ "signed": true, "summary": "Signed through 2034 at $X.XM per year." }
```

Use `"signed": false` to force NO, or `null` to go back to automatic. `"blockedUrls": ["https://..."]` hides specific news items.

## Notes

- Google News links are redirect links. They open the original article.
- Headline wording comes from the feeds. To keep an item off the page, add its `url` from `status.json` to `blockedUrls` in `manual.json`.
- GitHub can pause scheduled workflows in repos with no activity for 60 days. The script commits whenever the date or content changes, which keeps the repo active.
- Preview the signed look by opening the page with `#preview-yes` on the end of the URL.
- Fan-made and unaffiliated with the Wild, the NHL, the NHLPA or Quinn Hughes.
