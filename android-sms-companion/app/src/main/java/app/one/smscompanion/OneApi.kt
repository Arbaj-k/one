package app.one.smscompanion
import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object OneApi {
    private const val BASE = "https://tcthrfpkydcmenxwajfg.supabase.co"
    private const val PUBLIC_KEY = "sb_publishable_-PlVhv38rbHYFqsfvJ42AQ_S6-2A7JT"
    private const val PREFS = "one_secure_session"
    private fun prefs(context: Context) = EncryptedSharedPreferences.create(context, PREFS,
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    fun token(context: Context): String? = prefs(context).getString("access_token", null)
    fun saveSession(context: Context, access: String, refresh: String) { prefs(context).edit().putString("access_token", access).putString("refresh_token", refresh).apply() }
    fun clearSession(context: Context) { prefs(context).edit().clear().apply() }
    private suspend fun request(path: String, method: String, bearer: String? = null, body: JSONObject? = null): JSONObject = withContext(Dispatchers.IO) {
        val connection = (URL(BASE + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 15000; readTimeout = 20000
            setRequestProperty("apikey", PUBLIC_KEY); setRequestProperty("Content-Type", "application/json")
            if (bearer != null) setRequestProperty("Authorization", "Bearer " + bearer)
            if (body != null) doOutput = true
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val message = try { JSONObject(text).optString("msg", JSONObject(text).optString("message", "Request failed (" + status + ")")) } catch (_: Exception) { "Request failed (" + status + ")" }
                throw IllegalStateException(message)
            }
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally { connection.disconnect() }
    }
    suspend fun login(context: Context, email: String, password: String) {
        val result = request("/auth/v1/token?grant_type=password", "POST", body = JSONObject().put("email", email).put("password", password))
        val access = result.optString("access_token"); val refresh = result.optString("refresh_token")
        if (access.isBlank()) throw IllegalStateException("One did not return a sign-in session.")
        saveSession(context, access, refresh)
    }
    suspend fun sync(context: Context, transactions: List<ParsedTransaction>): JSONObject {
        val access = token(context) ?: throw IllegalStateException("Sign in to One in the companion app first.")
        val array = JSONArray()
        transactions.forEach { tx -> array.put(JSONObject().put("amount", tx.amount).put("direction", tx.direction).put("merchant", tx.merchant).put("upiReference", tx.upiReference).put("sender", tx.sender).put("transactionAt", tx.transactionAt).put("fingerprint", tx.fingerprint)) }
        return request("/functions/v1/bank-sms-sync", "POST", access, JSONObject().put("transactions", array))
    }
}
