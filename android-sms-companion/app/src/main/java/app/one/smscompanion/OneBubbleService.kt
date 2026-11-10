package app.one.smscompanion

import android.app.*
import android.content.Intent
import android.graphics.PixelFormat
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat
import kotlin.math.abs

class OneBubbleService : Service() {
    private lateinit var wm: WindowManager
    private var bubble: View? = null
    private lateinit var bubbleParams: WindowManager.LayoutParams
    private var startX = 0
    private var startY = 0
    private var touchX = 0f
    private var touchY = 0f
    private var moved = false

    override fun onCreate() {
        super.onCreate()
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return }
        val channel = "one_floating_assistant"
        if (Build.VERSION.SDK_INT >= 26) {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel(channel, "One floating assistant", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 10, Intent(this, MainActivity::class.java).putExtra("open_quick_note", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, channel)
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setContentTitle("One is ready")
            .setContentText("Floating quick capture is active. Tap to add a note.")
            .setContentIntent(open).setOngoing(true).build()
        startForeground(701, notification)
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        val view = TextView(this).apply {
            text = "✦"
            textSize = 25f
            gravity = Gravity.CENTER
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundResource(android.R.drawable.dialog_holo_light_frame)
            elevation = 12f
            contentDescription = "Open One quick note"
            setOnTouchListener { v, event ->
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        moved = false
                        startX = bubbleParams.x; startY = bubbleParams.y
                        touchX = event.rawX; touchY = event.rawY
                        true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (event.rawX - touchX).toInt()
                        val dy = (event.rawY - touchY).toInt()
                        if (abs(dx) > 5 || abs(dy) > 5) moved = true
                        bubbleParams.x = startX - dx
                        bubbleParams.y = startY + dy
                        try { wm.updateViewLayout(v, bubbleParams) } catch (_: Exception) {}
                        true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (!moved) {
                            val intent = Intent(this@OneBubbleService, MainActivity::class.java).putExtra("open_quick_note", true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                            startActivity(intent)
                        }
                        true
                    }
                    else -> false
                }
            }
        }
        bubble = view
        bubbleParams = params
        try { wm.addView(view, bubbleParams) } catch (_: Exception) { stopSelf() }
    }

    private val params: WindowManager.LayoutParams
        get() = WindowManager.LayoutParams(
            (54 * resources.displayMetrics.density).toInt(),
            (54 * resources.displayMetrics.density).toInt(),
            if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply { gravity = Gravity.TOP or Gravity.END; x = (12 * resources.displayMetrics.density).toInt(); y = (220 * resources.displayMetrics.density).toInt() }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY
    override fun onDestroy() {
        bubble?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        bubble = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
}
