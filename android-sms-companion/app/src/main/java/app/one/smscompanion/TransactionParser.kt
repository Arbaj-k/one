package app.one.smscompanion
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

data class ParsedTransaction(val amount: Double, val direction: String, val merchant: String, val upiReference: String, val sender: String, val transactionAt: String, val fingerprint: String)

object TransactionParser {
    private val amountRegex = Regex("""(?i)(?:₹|INR\s?|Rs\.?\s?)([0-9,]+(?:\.[0-9]{1,2})?)""")
    private val refRegex = Regex("""(?i)(?:UPI\s*(?:Ref(?:erence)?|Txn|Transaction)?\s*(?:No\.?|ID)?|Ref(?:erence)?\s*(?:No\.?|ID)?)[\s:#-]*([0-9]{8,})""")
    private val merchantRegex = Regex("""(?i)\b(?:to|at|from)\s+([A-Za-z0-9._@ -]{2,48}?)(?:\s+(?:on|ref|upi|for|via)\b|[.,;]|$)""")
    fun parse(sender: String, body: String, receivedAt: Long): ParsedTransaction? {
        val text = body.replace('\u00a0', ' ')
        val lower = text.lowercase(Locale.ROOT)
        if (!Regex("""\bupi\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)) return null
        if (Regex("""\b(otp|one.time.password|verification code)\b""", RegexOption.IGNORE_CASE).containsMatchIn(text)) return null
        val direction = when {
            Regex("""\b(debited|paid|sent|payment successful|transferred)\b""").containsMatchIn(lower) -> "debit"
            Regex("""\b(credited|received|refund received)\b""").containsMatchIn(lower) -> "credit"
            else -> return null
        }
        val amount = amountRegex.find(text)?.groupValues?.getOrNull(1)?.replace(",", "")?.toDoubleOrNull() ?: return null
        if (amount <= 0 || amount > 10_000_000) return null
        val ref = refRegex.find(text)?.groupValues?.getOrNull(1).orEmpty()
        val merchant = merchantRegex.find(text)?.groupValues?.getOrNull(1)?.trim()?.takeIf { it.isNotBlank() } ?: "UPI transaction"
        val canonical = text.lowercase(Locale.ROOT).replace(Regex("""\s+"""), " ").trim()
        val fingerprint = MessageDigest.getInstance("SHA-256").digest("$sender|$canonical".toByteArray()).joinToString("") { "%02x".format(it) }
        val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(receivedAt))
        return ParsedTransaction(amount, direction, merchant, ref, sender, iso, fingerprint)
    }
}
