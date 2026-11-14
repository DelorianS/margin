#!/usr/bin/env bash
# Build real ARM64 device code on a macOS runner. Signing is left to the installer.
set -euo pipefail
mobile_dir="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="$mobile_dir/output"
mkdir -p "$output_dir"
xcodebuild -version
xcodebuild \
  -project "$mobile_dir/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$output_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  build 2>&1 | tee "$output_dir/xcodebuild.log"

app_dir="$output_dir/DerivedData/Build/Products/Release-iphoneos/App.app"
test -d "$app_dir"
platform=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$app_dir/Info.plist")
test "$platform" = iPhoneOS
executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app_dir/Info.plist")
lipo -archs "$app_dir/$executable" | grep -qw arm64

# ditto preserves app symlinks and resource layout, including embedded frameworks.
mkdir -p "$output_dir/Payload"
ditto "$app_dir" "$output_dir/Payload/App.app"
(
  cd "$output_dir"
  ditto -c -k --sequesterRsrc --keepParent Payload Marginalia-unsigned.ipa
  unzip -t Marginalia-unsigned.ipa
  shasum -a 256 Marginalia-unsigned.ipa > Marginalia-unsigned.ipa.sha256
)
cat > "$output_dir/INSTALL.txt" <<'INSTALL'
Marginalia for iPhone and iPad (iOS/iPadOS 17+)

This is an UNSIGNED device IPA, not a simulator build.
Import Marginalia-unsigned.ipa into your preferred iOS signing/sideloading tool.
The tool must sign the app and embedded frameworks for your Apple account/device.
The unsigned IPA cannot be installed directly by opening it on an iPhone/iPad.
No Apple credentials, PC library, models, or pairing tokens are included.

After installation: start Marginalia on your PC, connect both devices to the same
home network, and paste the PC pairing link into Connect to my PC in the app.
Save stories on the device before switching the PC off.
INSTALL
printf '%s\n' 'Built mobile/output/Marginalia-unsigned.ipa for personal signing.'
