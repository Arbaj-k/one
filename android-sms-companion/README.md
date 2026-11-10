# One SMS Sync — Android companion

This companion app reads incoming SMS only after you sign in and explicitly enable capture. It filters UPI alerts locally and sends parsed transaction fields to the authenticated One account over HTTPS.

## Build
Open this folder in Android Studio (JDK 17, Android SDK 35), or run `gradle :app:assembleDebug`.
APK: `app/build/outputs/apk/debug/app-debug.apk`.

## Install
Install the debug APK on your own Android phone. Open One SMS Sync, sign in using the same One account, grant SMS receive permission, and turn on capture.

## Privacy
- No inbox scan or SMS body upload/storage.
- Only incoming messages containing UPI, an explicit debit/credit signal and a currency amount are considered.
- OTPs and unrelated messages are ignored.
- SHA-256 fingerprints and UPI references prevent duplicate Money entries.
- Capture can be turned off or disconnected at any time.
- The app sends parsed transaction fields only over HTTPS to One's authenticated Supabase Edge Function.
- This is a personal sideload build. Google Play restricts SMS permissions and may require declaration/approval.

## Limitations
Bank SMS formats vary. Alerts without currency markers, UPI keyword, or clear debit/credit language are skipped rather than guessed. Validate entries in One Money after first use.
