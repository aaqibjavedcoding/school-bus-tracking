/* eslint-env node */
/**
 * Dynamic Expo config — a thin layer over the pinned static `app.json`.
 *
 * Its single job is wiring the Android Google Maps SDK key:
 *
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY → android.config.googleMaps.apiKey
 *
 * The Android Maps SDK requires the key as a manifest meta-data entry, not a
 * JS prop, and the APK always carries it in plaintext (that is simply how
 * Google Maps on Android works — "shipping inside the APK" is expected and
 * documented). Because of that the key must never be committed; it is read
 * here from `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` at prebuild/build time:
 * `.env` / shell env for local runs, or the EAS build profile `env` (or EAS
 * environment variables) for cloud builds. In Google Cloud the key should be
 * restricted to the "Maps SDK for Android" API plus this app's package and
 * signing-certificate SHA-1, so a copied key is useless elsewhere.
 *
 * When the variable is unset (e.g. Expo Go, where Maps runs on its own key),
 * no key is injected and `react-native-maps` keeps its default behaviour.
 *
 * All other values stay exactly as pinned in `app.json` (spread, untouched).
 */
const appJson = require('./app.json');

module.exports = () => {
  // The spread keeps every pinned static value byte-identical; only the
  // Android Maps key is resolved from the environment per build.
  const config = { ...appJson.expo };
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (googleMapsApiKey) {
    config.android = {
      ...config.android,
      config: {
        ...config.android?.config,
        googleMaps: {
          apiKey: googleMapsApiKey,
        },
      },
    };
  }

  return config;
};
