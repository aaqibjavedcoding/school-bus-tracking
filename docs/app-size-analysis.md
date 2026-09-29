# App size analysis — "build 160 MB ka kyun hai?"

**Date:** 30 Sep 2026 · **Scope:** `mobile/` (Android). Web bundle bhi check kiya, wo saaf hai.
**Method:** static analysis of `mobile/package.json`, `app.json`, `app.config.js`,
`eas.json`, `metro.config.js`, `assets/`, aur poore `mobile/src` + `mobile/app` ka
import graph. Sandbox me `node_modules` install nahi hai, isliye koi build nahi
chalaya ja saka — har estimate ke saath uska source diya gaya hai, aur section 8
me exact measurement commands hain.

---

## 1. Seedha jawab

**160 MB zyada nahi hai — ye us artifact ke liye normal hai jo aap download kar
rahe ho.** Aap `eas build --profile development` chala rahe ho. Us profile me
`developmentClient: true` hai (`mobile/eas.json:8`), yaani wo ek **dev-client /
debug APK** hai: debug runtime, dev menu, poora Hermes debug tooling, chaaro CPU
architectures, aur native libraries **uncompressed**.

Expo ki apni official numbers, ek **bilkul khaali** app ke liye
([docs.expo.dev/distribution/app-size](https://docs.expo.dev/distribution/app-size/)):

| SDK | APK (debug) | APK (release) | AAB | **Play Store download** |
|---|---|---|---|---|
| 49 | 66 MB | 27.6 MB | 28.2 MB | 11.7 MB |
| 50 | **168.1 MB** | 62.1 MB | 27.4 MB | **11.7 MB** |

Khaali app ka debug APK hi **168 MB** hai. Aapka 50,000 line ka app + MapLibre
native + camera + notifications sab milakar **160 MB** pe hai — matlab aapka
apna code us number me lagbhag kuch add hi nahi kar raha. Debug APK ka size
aapke code se nahi, RN debug runtime + 4 ABI se aata hai.

> SDK 49 → 50 me debug APK 66 MB se 168 MB ho gaya. Iska kaaran aapka code nahi —
> React Native 0.73 ne `minSdkVersion` 23 kiya, jisse `extractNativeLibs` ka
> default `false` ho gaya, aur native `.so` files APK me **bina compress** ke
> rakhi jaane lagi. Ye hi aaj bhi aapko dikh raha hai.

**Aapka asli user Play Store se kitna download karega? Aaj ke config pe ~30–40 MB.**
Neeche wale fixes ke baad **~26–35 MB**.

---

## 2. Size ki seedhi (estimate)

| # | Artifact | Config | Size | Kaun download karta hai |
|---|---|---|---|---|
| 1 | `--profile development` APK | dev client · debug · 4 ABI · uncompressed libs · no minify | **~160 MB ← aapko yahi mila** | sirf aap + testers |
| 2 | `--profile preview` APK (aaj) | release · 4 ABI · no ProGuard · uncompressed libs | ~90–120 MB | testers |
| 3 | `--profile preview` APK (F2+F3 ke baad) | release · arm64+v7a · ProGuard · legacy packaging | **~40–55 MB** | testers |
| 4 | `--profile production` AAB → Play download (aaj) | Play device ke hisaab se split karta hai | ~30–40 MB | **asli user** |
| 5 | wahi, F4 ke baad | icon fonts hataane ke baad | **~26–35 MB** | **asli user** |

Rows 2–5 estimates hain (Expo ki baseline table + comparable RN+MapLibre apps ke
measured numbers se). Row 1 verified hai — wo aapka apna build hai.

**Sabse zaroori baat:** row 1 ka number kabhi bhi kisi user tak nahi jaata. Usko
optimize karna waqt ki barbadi hai. Optimize row 4/5 karna hai.

---

## 3. Findings — jo asli me fix karne layak hai

### F1 — Field testing ke liye galat profile build ho raha hai · *saving: ~50–70 MB · effort: 0*

`docs/notifications.md:152` testers ko `eas build --profile development` bolta
hai. Wo profile **push testing** ke liye theek hai (dev client chahiye), lekin
kisi principal ya driver ko app dene ke liye **galat** hai.

```
development  → dev client, debug variant   → ~160 MB   (sirf development ke liye)
preview      → release variant, APK        → ~90-120 MB (testers ke liye — yahi bhejo)
production   → AAB → Play Store            → ~30-40 MB  (users)
```

`preview` profile already sahi set hai (`mobile/eas.json:12-20`, distribution
internal + APK + prod API URL). Bas use kiya nahi ja raha.

**Fix:** docs me clearly likho ki kaunsa profile kiske liye hai. Code change zero.

---

### F2 — `expo-build-properties` kahin nahi hai, yaani koi Android optimization ON nahi · *saving: 20–35% release APK · effort: S*

Verified — poore repo me zero hits:

```
$ grep -rn "expo-build-properties|enableProguard|shrinkResources|useLegacyPackaging" .
(kuch nahi)
```

Iska matlab aaj release build me:

| Setting | Aaj | Asar |
|---|---|---|
| `enableProguardInReleaseBuilds` | ❌ off | R8 dead Java/Kotlin code nahi hata raha |
| `enableShrinkResourcesInReleaseBuilds` | ❌ off | unused Android resources ship ho rahe |
| `useLegacyPackaging` | ❌ off (RN 0.73+ default) | native `.so` **uncompressed** — SDK 49→50 wala 100 MB jump yahi hai |

**Fix:** `expo-build-properties@~57.0.22` add karo (SDK 57 line — `verify-expo-sdk.mjs`
ka guard isi version pe pass hoga) aur `app.config.js` ke plugin list me daalo.

`useLegacyPackaging` ka trade-off imaandari se: compressed libs = chhota APK,
lekin install ke waqt unzip hote hain aur cold start thoda dhima hota hai. Isliye
**sirf internal APK profiles pe ON karo, production AAB pe OFF** — Play khud
wire pe compress karta hai, to AAB pe legacy packaging ulta nuksaan karta hai.
`app.config.js` already `process.env` padhta hai (`isNativeAndroidBuild`), to isko
`EAS_BUILD_PROFILE` se drive karna is file ke existing pattern me fit ho jaata hai.

---

### F3 — Har APK me chaaro CPU architectures ja rahe hain · *saving: ~40–50 MB · effort: S*

`eas.json` me koi ABI restriction nahi hai, to Gradle universal APK banata hai:
`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64` — chaaron.

Ek comparable RN app (same problem, real measurement) ka APK slice breakdown:

| slice | size | share |
|---|---|---|
| `lib/x86` | 24.9 MB | 20.6% |
| `lib/x86_64` | 24.1 MB | 19.9% |
| `lib/arm64-v8a` | 22.6 MB | — |
| `lib/armeabi-v7a` | 15.5 MB | — |

121 MB ke APK me **87 MB sirf `lib/`** tha, aur usme se **49 MB x86/x86_64** —
jo kisi bhi asli phone pe kabhi nahi chalta (sirf emulator pe). Aapke app me
MapLibre Native bhi hai, jo ek badi `.so` hai, to ye slice aur bada hoga.

Usi app ne `preview` profile pe ARM-only kiya to **121.3 MB → 71.9 MB**.
Ek doosre project ne arm64-only kiya to **107 MB → 45 MB**.

**Fix — per-profile, `app.json` ko chhue bina:**

```jsonc
// mobile/eas.json
"preview": {
  "distribution": "internal",
  "android": {
    "buildType": "apk",
    "env": {
      // Gradle ORG_GRADLE_PROJECT_* env vars ko project property ki tarah padhta hai.
      // RN ka Gradle plugin reactNativeArchitectures ko defaultConfig.ndk.abiFilters
      // me daalta hai, jo har packaged .so filter karta hai — prebuilt AAR waale bhi.
      "ORG_GRADLE_PROJECT_reactNativeArchitectures": "armeabi-v7a,arm64-v8a"
    }
  }
}
```

`development` profile ko **universal hi rehne do** — warna x86 emulator pe app
install nahi hoga. Aur `production` (AAB) ko bhi chhedne ki zarurat nahi: Play
khud per-device split karta hai.

> `expo-build-properties` ka `buildArchs` option bhi exist karta hai, lekin
> (a) us par ek khula bug hai jahan EAS pe wo ignore ho jaata hai
> ([expo/expo#38225](https://github.com/expo/expo/issues/38225)), aur (b) wo
> `app.json` me baithta hai, to sab profiles pe lagta hai. `eas.json` env
> per-profile hai aur zyada predictable.

---

### F4 — `@expo/vector-icons` saare icon fonts bundle kar raha hai · *saving: ~4 MB **Play download pe bhi** · effort: M*

Ye is list ka **sabse valuable fix** hai, kyunki F1/F2/F3 sirf APK ka size
ghatate hain — **F4 wo number ghatata hai jo aapka asli user Play Store pe
dekhta hai.** Fonts na ABI-specific hote hain na density-specific, isliye Play
unhe split karke hata nahi sakta. Jo bundle hua, wo har user download karega.

Verified:

```
barrel imports  — from '@expo/vector-icons'    : 31 files
deep imports    — from '@expo/vector-icons/…'  :  0 files
icon families actually used                     :  1  (Ionicons)
distinct glyph names actually used              : ~50
@expo/vector-icons package size                 : 6.01 MB
```

Barrel (`@expo/vector-icons` ka index) saari ~20 families re-export karta hai, aur
har family apna `.ttf` `require()` karti hai. Metro ke liye wo sab reachable hain,
to **saare fonts bundle ho jaate hain** — MaterialCommunityIcons, FontAwesome5,
Fontisto, Zocial, sab — jabki aap sirf Ionicons use karte ho.

Expo ne khud ye blog kiya hai:
["Moving away from @expo/vector-icons"](https://expo.dev/blog/moving-away-from-expo-vector-icons) —
*"we cut the shipped bundle and asset payload size by around 4 MB just by changing
an import statement and a package.json dependency."*

**Fix (do options):**

1. **Minimal, 30 minute ka:** 31 files me
   `import { Ionicons } from '@expo/vector-icons'` →
   `import Ionicons from '@expo/vector-icons/Ionicons'`.
   Ek type-only import bhi hai (`crew-action-meta.ts:1`) — wo bhi update karna hai.
   Ek lint rule add karo taaki barrel import wapas na aaye.
2. **Expo ki recommended direction:** `@react-native-vector-icons/ionicons` pe
   migrate karo aur `@expo/vector-icons` dependency hata do. Expo agle SDK me
   `@expo/vector-icons` deprecate karne wala hai, to ye waise bhi aana hai.

Option 1 abhi karo (risk ~0, saving lagbhag utni hi). Option 2 tab jab SDK 58 pe
jaao.

---

### F5 — `assets/gen/bus-master.png` 1.6 MB · *saving: 0–1.6 MB · effort: XS*

Ye poore repo ki **sabse badi tracked file** hai:

```
1642657  mobile/assets/gen/bus-master.png     ← #1
 579576  package-lock.json
 386285  docs/brand/logo-polish-evidence-mobile.png
 ...
```

Codebase me iska ek hi reference hai — `scripts/make-bus-marker.py:20`. Yaani ye
ek **build-time source** hai jisse `bus-marker@1x/2x/3x.png` generate hote hain;
app khud isse kabhi `require()` nahi karta.

Metro sirf `require()` ki hui assets bundle karta hai, to ye **shayad** APK me
nahi ja raha. Lekin `app.json` me `assetBundlePatterns` pin nahi kiya gaya
(default `**/*`), aur file `assets/` ke andar hi padi hai — to ye ek silent risk
hai, koi guarantee nahi.

**Fix:** `mobile/assets/gen/` ko `mobile/scripts/assets/` (ya `tools/`) me move
karo, aur `app.json` me `assetBundlePatterns` explicitly pin karo taaki sirf wahi
ship ho jo chahiye. Ye Session 4 (shared 3D bus) ke saath waise bhi touch hoga —
tab master SVG ban jayega, PNG nahi.

---

## 4. Jo problem **nahi** hai (yahan time mat lagao)

| Cheez | Status | Kyun theek hai |
|---|---|---|
| Aapka apna code (50k LOC TS/TSX) | ✅ | Hermes bytecode me kuch MB. Debug APK ke 160 MB me ~2% bhi nahi. |
| Dependency list (20 runtime deps) | ✅ | Sab use ho rahe hain — maine `expo-camera` (ProfilePhotoCard), `expo-speech` (crew-voice, sos-alert), `expo-haptics`, `expo-task-manager`, `expo-notifications`, sabke call sites verify kiye. Koi lodash / moment / heavy junk nahi. Hataane ko kuch nahi hai. |
| `react-dom` + `react-native-web` deps me | ✅ | Sirf `.web.tsx` files se pahunchte hain, jinhe Metro native platform pe skip kar deta hai. APK me nahi jaate. |
| `expo-dev-client` `dependencies` me | ✅ | Expo isko sirf debug variant me link karta hai. Release APK/AAB me nahi. |
| Icons / splash images | ✅ | icon 51 KB, adaptive-icon 41 KB, splash 22 KB. Bilkul normal. |
| Repo ke baaki assets | ✅ | `docs/brand/*.png` evidence screenshots hain — kabhi ship nahi hote. |
| Web app ka bundle | ✅ | `web/public` total 392 KB. `maplibre-gl` already `next/dynamic ssr:false` ke peeche lazy chunk me hai (`MapView.tsx`). |
| Duplicate React (metro pin) | ✅ | `metro.config.js` `SINGLE_INSTANCE_PACKAGES` se ek hi React bundle hota hai. Achha kaam. |

Ek aur cheez jo **nahi** karni: "Expo chhod do, plain React Native CLI pe jao"
wala purana internet advice. Wo SDK 32 ke zamane ka hai. EAS Build aaj sirf wahi
native modules link karta hai jo aapke paas hain — Expo se nikalne se aaj koi
meaningful size fayda nahi milta, sirf poora native maintenance sar pe aa jaata hai.

---

## 5. Kya kya fix hoga — expected result

| Fix | Preview APK pe | **Play download pe** | Effort | Risk |
|---|---|---|---|---|
| F1 — `preview` profile use karo | −50 se −70 MB | — | 0 (docs) | none |
| F2 — ProGuard + shrink + legacy packaging | −20% se −35% | ~−1 MB | S | low¹ |
| F3 — ARM-only preview APK | −40 se −50 MB | — | S | low² |
| **F4 — icon font barrel hatao** | **−4 MB** | **−4 MB** ✅ | M | none |
| F5 — bus-master.png bahar karo | 0 se −1.6 MB | 0 se −1.6 MB | XS | none |

¹ ProGuard reflection-based code tod sakta hai. Is app me risk kam hai
(`sequelize`/`class-validator` sirf server pe hain, mobile pe nahi), lekin
ProGuard ON karne ke baad ek release build phone pe **poora smoke test** karna
zaroori hai — khaas kar Firebase push aur MapLibre.

² ARM-only APK x86 emulator pe install nahi hoga. Isliye ye sirf `preview` pe
lag raha hai, `development` universal hi rahega.

---

## 6. Ye kab karna chahiye

Ye kaam **P2** hai — 160 MB aaj kisi user ko nuksaan nahi pahuncha raha, kyunki
koi user wo file download hi nahi karta. Live map ke P0/P1 defects (Sessions 1–4)
pehle.

**Exception:** F1 abhi karo (sirf docs ka ek line change hai, aur aapke testers ka
download 160 → ~100 MB ho jayega), aur F4 ko Session 4 (UI polish) ke saath clip
kar do — tab waise bhi icons/assets touch honge.

---

## 7. Sahi measurement kaise karein

Estimates se kaam nahi chalta. APK haath me aane ke baad ye chalao:

```bash
# 1. ABI slices — har architecture kitna MB le raha hai
unzip -l app.apk | awk '$4 ~ /^lib\// {split($4,a,"/"); s[a[2]]+=$1}
  END {for (k in s) printf "%-14s %8.2f MB\n", k, s[k]/1048576}' | sort -k2 -rn

# 2. Icon fonts — F4 ka proof (aaj ~20 .ttf dikhne chahiye, fix ke baad 1)
unzip -l app.apk | awk '$4 ~ /\.ttf$/ {printf "%8.2f KB  %s\n", $1/1024, $4}' | sort -rn

# 3. Sabse badi 40 entries — koi surprise asset pakadne ke liye
unzip -l app.apk | sort -k1 -rn | head -40

# 4. JS bundle ka per-module breakdown (treemap UI khulta hai)
cd mobile && EXPO_ATLAS=1 npx expo export --platform android && npx expo-atlas
```

Aur asli user-facing number ke liye — **Play Console → Android vitals → App size**.
Wahi ek jagah hai jahan sach likha hota hai; APK/AAB ka file size nahi.

Har fix se pehle aur baad me command #1 aur #2 chala kar numbers
`docs/app-size-analysis.md` me record karo, taaki agli baar guess na karna pade.

---

## 8. One-line summary

> 160 MB aapka app nahi hai — wo **dev-client debug APK** hai, aur Expo ki apni
> khaali app bhi 168 MB ki hai. Aapke user ko Play Store se **~30–40 MB** milega.
> Phir bhi 4 asli wins hain: sahi profile bhejo (−60 MB), ProGuard + legacy
> packaging ON karo (−25%), preview APK ko ARM-only karo (−45 MB), aur icon-font
> barrel import hatao (−4 MB, **ye wala user tak bhi pahunchta hai**).
