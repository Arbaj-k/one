package app.one.smscompanion
import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

class MainActivity : Activity() {
    private val scope = MainScope()
    private lateinit var status: TextView
    private lateinit var email: EditText
    private lateinit var password: EditText
    private lateinit var capture: Switch
    private lateinit var loginButton: Button
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (22 * resources.displayMetrics.density).toInt()
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad); setBackgroundColor(0xFF0D1729.toInt()) }
        fun label(text: String, size: Float = 15f) = TextView(this).apply { this.text = text; textSize = size; setTextColor(0xFFE8EEFF.toInt()) }
        root.addView(label("✦  One", 30f)); root.addView(label("UPI SMS sync", 22f))
        root.addView(label("Bank UPI alerts are parsed on this phone. Only transaction details are sent to your signed-in One account after you enable capture.", 15f).apply { setPadding(0, pad / 2, 0, pad) })
        email = EditText(this).apply { hint = "One account email"; setSingleLine(); setTextColor(-1) }
        password = EditText(this).apply { hint = "One account password"; inputType = 129; setSingleLine(); setTextColor(-1) }
        root.addView(email); root.addView(password)
        loginButton = Button(this).apply { text = "Sign in to One" }; root.addView(loginButton)
        status = label("Not connected. Sign in with your One account.", 13f); root.addView(status)
        capture = Switch(this).apply {
            text = "Enable UPI SMS capture"; setTextColor(0xFFE8EEFF.toInt())
            isChecked = getSharedPreferences("one_sms_settings", MODE_PRIVATE).getBoolean("capture_enabled", false)
            isEnabled = !OneApi.token(this@MainActivity).isNullOrBlank()
        }; root.addView(capture)
        root.addView(label("Only messages clearly marked UPI with a debit/credit signal and amount are considered. OTPs and unrelated SMS are ignored. You can turn capture off or disconnect at any time.", 12f))
        val disconnect = Button(this).apply { text = "Disconnect One account" }; root.addView(disconnect)
        setContentView(ScrollView(this).apply { addView(root) })
        if (!OneApi.token(this).isNullOrBlank()) {
            status.text = "Connected to One. Turn on capture when ready."
            email.visibility = View.GONE; password.visibility = View.GONE; loginButton.visibility = View.GONE; capture.isEnabled = true
        }
        loginButton.setOnClickListener {
            val mail = email.text.toString().trim(); val pass = password.text.toString()
            if (mail.isBlank() || pass.isBlank()) { status.text = "Enter your One email and password."; return@setOnClickListener }
            loginButton.isEnabled = false
            scope.launch {
                try {
                    OneApi.login(this@MainActivity, mail, pass)
                    status.text = "Connected. Allow SMS access, then enable capture."
                    capture.isEnabled = true; email.visibility = View.GONE; password.visibility = View.GONE; loginButton.visibility = View.GONE
                    requestSmsPermission()
                } catch (e: Exception) { status.text = e.message ?: "Sign in failed." }
                finally { loginButton.isEnabled = true }
            }
        }
        capture.setOnCheckedChangeListener { _, enabled ->
            if (enabled) {
                if (OneApi.token(this).isNullOrBlank()) { capture.isChecked = false; status.text = "Sign in first."; return@setOnCheckedChangeListener }
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED) {
                    capture.isChecked = false; requestSmsPermission(); return@setOnCheckedChangeListener
                }
            }
            getSharedPreferences("one_sms_settings", MODE_PRIVATE).edit().putBoolean("capture_enabled", enabled).apply()
            status.text = if (enabled) "UPI SMS capture is on. Matched transactions sync to One." else "UPI SMS capture is off."
        }
        disconnect.setOnClickListener {
            capture.isChecked = false; OneApi.clearSession(this)
            email.visibility = View.VISIBLE; password.visibility = View.VISIBLE; loginButton.visibility = View.VISIBLE; capture.isEnabled = false
            status.text = "Disconnected. Your One workspace data is not deleted."
        }
    }
    private fun requestSmsPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) != PackageManager.PERMISSION_GRANTED)
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.RECEIVE_SMS), 41)
        else status.text = "SMS permission is ready. Enable capture when ready."
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 41) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) { capture.isEnabled = true; status.text = "SMS access granted. Enable capture when ready." }
            else status.text = "SMS access denied. Automatic SMS capture is off."
        }
    }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
