# Windows “Publisher: Unknown” / SmartScreen

## Why users see it

Windows SmartScreen shows **Publisher: Unknown** when `LOLCallout-Setup-*.exe` (or the portable `.exe`) is **not Authenticode-signed** with a certificate from a trusted Certificate Authority (CA).

Unsigned apps look like random downloads. That’s by design — Microsoft is protecting users.

There is **no free permanent fix**. You must buy a **code signing certificate** and sign every release build.

## What fixes it

| Option | SmartScreen result | Notes |
|--------|-------------------|--------|
| **EV Code Signing** (recommended) | Instant reputation — publisher name shows immediately | USB token / cloud HSM required. Best for new products. |
| **OV / standard Code Signing** | Publisher name shows after signing; SmartScreen may still warn until downloads build reputation | Cheaper; cloud-issued certs common since 2023 |
| **Unsigned (current)** | Publisher: Unknown | Scares users |

Typical cost (varies by CA/reseller): roughly **$200–$800+/year**. Providers: SSL.com, Sectigo, DigiCert, Certum, etc.

You need a **legal identity** (usually a registered business / LLC). Individuals can sometimes get OV; EV almost always needs an organization.

## After you buy a cert

### 1. Install / access the cert

- **Cloud / eSigner / SSL.com cloud**: you’ll get API credentials or a PKCS#11 setup.
- **USB hardware token (EV classic)**: plug in, install vendor drivers, unlock with PIN.
- **PFX file** (less common now for new certs): export with password — keep it secret.

### 2. Set environment variables (never commit secrets)

**PFX file:**

```powershell
$env:CSC_LINK = "C:\path\to\codesign.pfx"
$env:CSC_KEY_PASSWORD = "your-pfx-password"
```

**Windows certificate store** (cert already imported):

```powershell
# electron-builder picks the cert matching publisherName when available
$env:CSC_NAME = "Your Exact Publisher Name LLC"
```

**Optional (some cloud workflows):**

```powershell
$env:WIN_CSC_LINK = "..."   # same as CSC_LINK for Windows
```

### 3. Rebuild the installer

```powershell
cd C:\Users\steve\riftcoach
powershell -ExecutionPolicy Bypass -File .\scripts\pack-release.ps1
```

electron-builder will sign:

- `LOLCallout.exe` (portable)
- `LOLCallout-Setup-*.exe` (installer)
- nested app binaries when packaging

Confirm:

```powershell
Get-AuthenticodeSignature .\apps\desktop\release\LOLCallout-Setup-0.3.2.exe |
  Format-List Status, SignerCertificate, StatusMessage
```

`Status` should be **Valid**. Publisher name should match your cert’s organization.

### 4. Publish the **new signed** build

Replace the GitHub Release assets. Old unsigned downloads keep the warning forever.

## While waiting for a cert (UX, not a security fix)

You **cannot** remove SmartScreen without signing. You can reduce fear:

1. **Site copy** — “Windows may say Publisher Unknown until we complete code signing. Click More info → Run anyway. Safe from lolcallout.com / our GitHub release.”
2. **Prefer the Setup installer** from the official domain only.
3. **Get downloads** so Microsoft’s reputation system warms up (unsigned still worse than signed).

## Site note (optional)

Add a short FAQ answer under Download / FAQ once the cert is active:

> **Why does Windows say “Publisher unknown”?**  
> We’re finishing Authenticode code signing. After the next signed release, Windows will show our company name as the publisher.

## electron-builder config

`apps/desktop/package.json` already enables:

- `win.signAndEditExecutable: true`
- SHA-256 + DigiCert RFC3161 timestamp server
- `publisherName: "LOLCallout"` — change this to the **exact** organization name on your certificate when you have it

If you don’t set `CSC_*` env vars, the build still succeeds **unsigned** (electron-builder skips signing with a warning).

## Checklist

- [ ] Buy OV or EV code signing cert (business identity ready)
- [ ] Update `publisherName` in `package.json` to match cert CN/O
- [ ] Set `CSC_LINK` + `CSC_KEY_PASSWORD` (or `CSC_NAME`)
- [ ] Run `pack-release.ps1`
- [ ] Verify with `Get-AuthenticodeSignature`
- [ ] Upload new Setup + portable to GitHub Releases
- [ ] Update site download links if version bumps
