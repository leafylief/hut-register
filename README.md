# Hut Register

The staff app for The Hut Warehouse. It runs on an iPad, an iPhone or an Android phone or tablet.

- **Sell:** tickets, drinks and classes as photo tiles, a cart, GRT added, then card (Stripe reader) or cash.
- **Guest list:** tonight's list by Crew, Friends and Guests, plus ones, check in, and a warning for anyone on the do not admit list.
- **Check in:** scan a ticket or wallet QR, or find someone by name or phone.
- **Show:** the night's lineup by stage and the crew roles.
- **Flyering:** every spot by area, large and small posters, and who did it.

It talks to the Hut system (`/api/pos`), so people, tickets, tokens and reports are the same as the website and the admin. Items, photos, events, lineups and guest lists are managed in the admin or through the system's API (`/api/v1/help`).

## Installing

Every push to `main` builds both versions on GitHub and puts them on the **Releases → latest** page.

- **Android:** open the release page on the tablet, download `hut-register.apk`, tap it, and allow installing from the browser when asked. It stays installed.
- **iPad / iPhone:** install SideStore once (set up with iLoader on a Windows PC), then open `hut-register.ipa` in SideStore. With a free Apple ID the app is re-signed every 7 days, which SideStore does on the iPad.

Sign in with the door PIN. Settings → System switches between the test site and the live site.

## Card readers

Settings → Card reader. "Find a Bluetooth reader" connects a Stripe Reader M2. "Use a test reader" connects Stripe's simulated reader on the test site, so the whole card flow can be tried with no hardware. The Hut's street address has to be saved in the admin (Settings → Card reader) before the first reader connects.

## Working on it

```
npm install
npm run build      # bundles src/app.js into www/app.js
npx cap sync       # copies www into the Android and iOS projects
```

The interface is plain JavaScript and CSS in `src/app.js` and `www/app.css`. The native projects in `android/` and `ios/` only change when plugins or permissions change.
