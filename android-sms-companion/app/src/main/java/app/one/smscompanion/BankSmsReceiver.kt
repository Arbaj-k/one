package app.one.smscompanion
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class BankSmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val prefs = context.getSharedPreferences("one_sms_settings", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("capture_enabled", false) || OneApi.token(context).isNullOrBlank()) return
        val parsed = Telephony.Sms.Intents.getMessagesFromIntent(intent).mapNotNull { sms ->
            TransactionParser.parse(sms.originatingAddress.orEmpty(), sms.messageBody.orEmpty(), sms.timestampMillis)
        }
        if (parsed.isEmpty()) return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try { OneApi.sync(context, parsed) }
            catch (error: Exception) { android.util.Log.w("OneSmsSync", "Sync failed: " + (error.message ?: "unknown")) }
            finally { pending.finish() }
        }
    }
}
