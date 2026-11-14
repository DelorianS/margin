# Build an IPA with GitHub Actions

The workflow at `.github/workflows/ios-ipa.yml` builds ARM64 iPhone/iPad code on a GitHub-hosted Mac, then packages `Marginalia-unsigned.ipa`. No Apple credentials are needed for this unsigned build. It is intended for a signing/sideloading tool; opening the unsigned file directly on a device does not install it.

1. Put `.github/`, `mobile/` and `public/` from this project in a GitHub repository you control. Keep your PC `data/` and installed `node_modules/` out of the repository. A private repository keeps the source private.
2. In **Actions**, select **Build iPhone and iPad IPA** and choose **Run workflow**. Pushing matching files to `main` or `mobile-cloud-build` also starts it.
3. Wait for the build to succeed, then download **Marginalia-unsigned-IPA** from that run's Artifacts section. Extract the artifact ZIP to get the IPA, checksum and installation notes. Artifacts are kept for 14 days.
4. Sign and install the IPA yourself using your chosen tool and Apple account. Device trust, provisioning and any signing expiry are controlled by that tool and your Apple account.

The workflow uploads its build log on failure. It does not publish to the App Store or TestFlight and does not store Apple credentials. GitHub-hosted macOS builds consume your account's Actions allowance; no paid runner or separate build service is configured here.

The GitHub connection must have access to the selected repository and permission to write workflow files before an assistant can upload and start this build. An empty repository may need an initial commit first.
