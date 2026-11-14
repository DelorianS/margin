# Marginalia for iPhone and iPad

This is a native iOS/iPadOS app project with the existing Marginalia interface bundled inside it. The reader does not load its interface from the PC. Saved chapters and character profiles stay on the device; AI work runs through your PC connection. The full library remains on the PC and must be deliberately saved to each device.

Version 1.1 downloads chapter text directly from HTTPS source sites on the iPhone/iPad. You can add a story, turn to new chapters, download a chapter range, paste text and read without a PC. New downloads need the device's internet connection; saved text works without internet. A site that blocks automated access still requires opening the original page and pasting text. Pairing is optional for reading.

Downloaded text is queued locally and syncs to the paired PC for Ask, recaps and character analysis. Restart the PC reader after updating its source so the new text-sync endpoint is available. Existing PC chapter text is preserved if a device copy differs; resolve that conflict on the PC before asking about that version. AI needs the PC awake and reachable. Profile appearance edits can still be saved offline.

## Prepare on this Windows PC

From `D:\Reader\mobile`:

```powershell
npm ci
npm run sync
npm run verify
```

The pinned Capacitor 8.6.2 packages generate the native bridge and copy the current `../public` interface into the app. Fonts, colors, the original Marginalia mark, reader settings, and profile styling are retained. Only public app assets are copied; `data/`, AI keys, PC models and pairing credentials are never bundled.

Run `npm run package:source` to sync, verify, and create `../dist/Marginalia-iPhone-iPad-source.zip` for transfer to a Mac. Extract it first, then follow the Mac steps below. The archive contains the app source and matching public design, and excludes installed packages and PC library data; it is not an installable `.ipa`.

## Install on your iPhone or iPad

To build in the cloud without a Mac of your own, follow [CLOUD-BUILD.md](CLOUD-BUILD.md). GitHub Actions produces an unsigned device IPA for your own signing/sideloading tool.

Apple's iOS tools require a **Mac with Xcode 26 or later**. Windows can prepare and validate this project but cannot compile or sign an installable iOS app.

1. Copy the whole Reader project to a Mac, or copy `mobile/` alongside its matching `public/` folder. Do not copy `node_modules/`.
2. Install Node.js 22.13 or later on the Mac. In `mobile/`, run `npm ci`, `npm run sync`, then `npm run open`.
3. In Xcode, open **App → Signing & Capabilities**, select your Apple development team, and choose a unique bundle identifier if Xcode requires one.
4. Connect your iPhone or iPad, select it as the destination, and press **Run**. Follow any device-trust and Developer Mode prompts from Apple.
5. For TestFlight or App Store distribution, archive and distribute using Xcode and your Apple Developer account. No app has been uploaded or published by this project.

Minimum device version: **iOS 17 / iPadOS 17**. Both device families and portrait/landscape orientations are enabled. The universal iPad target supports the existing responsive reader layout and the browser features used by its design.

## Connect the PC

Start **start-everything.bat** on the PC and keep both devices on the same trusted home network. Use the app's **Connect to PC** control and paste the private pairing link shown in **Read on iPad** on the PC. Accept iOS's local-network permission prompt. The AI is available while the PC and reader server are running. Saved device content remains readable while they are off.

The pairing code changes when the PC reader restarts. Paste the new pairing link to reconnect; saved device content remains available. If you denied local network permission, enable it in iPhone/iPad **Settings → Privacy & Security → Local Network → Marginalia**.

HTTP exceptions are limited to private home-network address ranges. The frontend validates the PC address and sends the pairing token only to that configured PC. HTTPS remains required for public internet resources. No port forwarding, Bonjour scanning, or broad network discovery is used.

## Validation and limits

`npm run verify` checks the copied interface against current public sources, bundled font files and licenses, icon dimensions, both device families, bundled startup and scoped networking. It does **not** compile Swift or claim a successful simulator/device run. A Mac/Xcode build and physical-device verification are still necessary before distribution. Check first connection, offline saved characters, offline edits and reconnection, portrait and landscape layout, and avatar selection on the target devices.

On iOS, Capacitor's native HTTP bridge buffers POST responses. AI answers therefore appear after completion rather than token by token. Stop sends an authenticated cancellation request to the PC while connected, and stopped or superseded answers are discarded by the interface. iOS can suspend the app in the background; leave it open while saving large selections. Removing the app also removes its device copy; keep the PC library as the primary copy.

## Maintaining the bundled design

Edit the original `public/` files, then run `npm run sync` in `mobile/` before building. Normal builds require no Google Fonts request. `scripts/update-fonts.mjs` is an optional maintenance download from Google Fonts with OFL licenses; `scripts/update-assets.ps1` rasterizes the existing favicon geometry for the native icon and launch screen.

Framework references: [Capacitor iOS requirements](https://capacitorjs.com/docs/ios), [native HTTP configuration](https://capacitorjs.com/docs/apis/http), [Apple local networking](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking), [Apple address-range exceptions](https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsexceptiondomains).
