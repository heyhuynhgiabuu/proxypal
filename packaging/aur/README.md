# AUR Packaging

This directory keeps the source-package metadata used to publish `proxypal` on AUR.

## Files

- `PKGBUILD` - Arch package build recipe for source builds.
- `.SRCINFO` - Machine-readable metadata generated from `PKGBUILD`.

## Update workflow

1. Update app versions in the main project:
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
2. Update `pkgver` / `pkgrel` in `packaging/aur/PKGBUILD`.
3. Recompute source checksum if `pkgver` changed:

```bash
curl -L "https://github.com/heyhuynhgiabuu/proxypal/archive/refs/tags/v${pkgver}.tar.gz" | sha256sum
```

4. Regenerate `.SRCINFO`:

```bash
cd packaging/aur
makepkg --printsrcinfo > .SRCINFO
```

5. Validate package metadata locally:

```bash
cd packaging/aur
makepkg --verifysource
makepkg --nobuild --nodeps
```

## Syncing to AUR repository

The AUR package lives in its own git repository. Sync by copying updated metadata files:

```bash
git clone ssh://aur@aur.archlinux.org/proxypal.git
cp packaging/aur/PKGBUILD proxypal/
cp packaging/aur/.SRCINFO proxypal/
cd proxypal
git add PKGBUILD .SRCINFO
git commit -m "Update proxypal to v${pkgver}"
git push
```
