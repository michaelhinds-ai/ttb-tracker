DISTILLERY TTB REPORTING TRACKER — deploy bundle
=================================================

This is a hosted web app (federal TTB + Kentucky reporting) with cross-device
sync. It is a static frontend plus one Netlify serverless function that stores
your data in Netlify Blobs, so every device that opens your private link sees
the same live data.

CONTENTS
  public/index.html            The app (also works standalone offline)
  netlify/functions/data.mjs   Sync API (GET/POST -> Netlify Blobs)
  netlify.toml                 Build config
  package.json                 Function dependency (@netlify/blobs)

TO DEPLOY (on a computer that can reach the internet normally):
  1. Install Node.js if you don't have it (nodejs.org).
  2. Open a terminal in this folder.
  3. Run:  npx netlify-cli deploy --build --prod
     - First run will open a browser to log in to your Netlify account.
     - When asked, link to the existing site "distillery-ttb-tracker"
       (or create a new one).
  4. It prints your live URL, e.g. https://distillery-ttb-tracker.netlify.app

USING IT
  - Open the site. It creates your private workspace and a sync link
    (the URL ends with #ws=YOURCODE).
  - Open that SAME link on your phone and other computers to share the data.
  - Setup & Sync tab has "Copy Link" and lets you enter an existing code.

Rates reflected: Federal CBMA ($2.70 / $13.34 / $13.50 per proof gallon);
Kentucky excise $1.92/gal, wholesale sales tax 11%, case tax $0.05/case,
and the HB 5 barrel-tax phase-out (96% in 2026 ... 0% in 2043). All editable
in Setup. Always confirm current figures at ttb.gov and revenue.ky.gov.
