; Pemasang paket gabungan Cognify + Cognify Notch (Windows).
; Membungkus dua Setup.exe Velopack. Tidak error dan tidak menurunkan versi bila salah satunya sudah terpasang:
;   - Notch/Cognify belum terpasang -> Setup-nya dijalankan.
;   - Sudah terpasang               -> dilewati (kedua app memperbarui dirinya lewat Velopack).
; Dibangun oleh .github/workflows/bundle-windows.yml. Manual (Windows, NSIS 3); path berkas harus absolut:
;   makensis /DVERSION=0.3.0 /DCOGNIFY_SETUP=Cognify-win-Setup.exe /DNOTCH_SETUP=CognifyNotch-win-Setup.exe ^
;            /DOUTFILE=Cognify-Notch-Windows-Setup.exe scripts\bundle-windows\Cognify-Notch.nsi
; Lokasi pemasangan Velopack: %LocalAppData%\{packId}; packId Notch = CognifyNotch (lihat notch-windows/ci/build.yml),
; packId Cognify = Cognify (dipastikan dari nama aset rilis v0.3.0: Cognify-0.3.0-full.nupkg).
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Cognify dan Notch"
OutFile "${OUTFILE}"
BrandingText "Cognify ${VERSION}"

!include "LogicLib.nsh"

Var Report

Section
  InitPluginsDir
  StrCpy $Report ""

  ; --- Cognify ---
  ${If} ${FileExists} "$LOCALAPPDATA\Cognify\current\*.*"
    StrCpy $Report "$Report- Cognify sudah terpasang, dilewati.$\r$\n"
  ${Else}
    File "/oname=$PLUGINSDIR\cognify-setup.exe" "${COGNIFY_SETUP}"
    ExecWait '"$PLUGINSDIR\cognify-setup.exe" --silent' $0
    ${If} $0 = 0
      StrCpy $Report "$Report- Cognify dipasang.$\r$\n"
    ${Else}
      StrCpy $Report "$Report- Cognify gagal dipasang (kode $0). Coba paket Cognify saja.$\r$\n"
    ${EndIf}
  ${EndIf}

  ; --- Cognify Notch ---
  ${If} ${FileExists} "$LOCALAPPDATA\CognifyNotch\current\*.*"
    StrCpy $Report "$Report- Cognify Notch sudah terpasang, dilewati.$\r$\n"
  ${Else}
    File "/oname=$PLUGINSDIR\notch-setup.exe" "${NOTCH_SETUP}"
    ExecWait '"$PLUGINSDIR\notch-setup.exe" --silent' $0
    ${If} $0 = 0
      StrCpy $Report "$Report- Cognify Notch dipasang.$\r$\n"
    ${Else}
      StrCpy $Report "$Report- Cognify Notch gagal dipasang (kode $0). Coba paket Notch saja.$\r$\n"
    ${EndIf}
  ${EndIf}

  MessageBox MB_OK|MB_ICONINFORMATION "Selesai.$\r$\n$\r$\n$Report" /SD IDOK
SectionEnd
