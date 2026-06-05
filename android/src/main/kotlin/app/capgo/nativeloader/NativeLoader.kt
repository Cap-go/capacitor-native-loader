package app.capgo.nativeloader

import android.animation.ValueAnimator
import android.animation.ObjectAnimator
import android.app.Activity
import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Build
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.animation.LinearInterpolator
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.widget.AppCompatImageView
import com.airbnb.lottie.LottieAnimationView
import com.airbnb.lottie.LottieDrawable
import java.io.File
import java.net.URL
import java.net.URLDecoder
import java.util.UUID
import java.util.concurrent.CountDownLatch
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

object NativeLoader {
    private const val VERSION = "native"
    private val mainHandler = Handler(Looper.getMainLooper())
    private val defaults = mutableMapOf<String, Any?>()
    private val timers = mutableMapOf<String, Runnable>()
    private var overlay: NativeLoaderOverlay? = null
    private var overlayActivity: Activity? = null
    private var webView: View? = null
    private var webViewSnapshot: WebViewSnapshot? = null
    private var restoreWebViewOnHide = true

    @JvmStatic
    fun getPluginVersion(): String = VERSION

    @JvmStatic
    fun configure(defaults: Map<String, Any?>) {
        runOnMain {
            this.defaults.putAll(defaults)
        }
    }

    @JvmStatic
    @JvmOverloads
    fun show(activity: Activity, options: Map<String, Any?> = emptyMap(), webView: View? = null): String {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            var id = ""
            val latch = CountDownLatch(1)
            mainHandler.post {
                id = show(activity, options, webView)
                latch.countDown()
            }
            latch.await()
            return id
        }

        val merged = defaults.toMutableMap().apply { putAll(options) }
        val item = LoaderItem(merged)
        this.webView = webView ?: this.webView

        (merged["webView"] as? Map<*, *>)?.let {
            restoreWebViewOnHide = bool(it["restoreOnHide"]) ?: true
            setWebViewLayout(it.toStringMap(), this.webView)
        }

        val targetOverlay = ensureOverlay(activity)
        targetOverlay.show(item)
        scheduleAutoHide(item)
        item.accessibilityLabel?.takeIf { it.isNotBlank() }?.let {
            targetOverlay.root.announceForAccessibility(it)
        }
        return item.id
    }

    @JvmStatic
    fun update(options: Map<String, Any?>) {
        runOnMain {
            val id = options["id"] as? String ?: return@runOnMain
            val current = overlay?.items?.get(id) ?: return@runOnMain
            val merged = current.rawOptions.toMutableMap().apply { putAll(options) }
            val item = LoaderItem(merged)
            overlay?.show(item)
            scheduleAutoHide(item)
        }
    }

    @JvmStatic
    @JvmOverloads
    fun setProgress(id: String? = null, progress: Double) {
        runOnMain {
            val overlay = overlay ?: return@runOnMain
            val targetId = id ?: overlay.items.keys.lastOrNull() ?: return@runOnMain
            val current = overlay.items[targetId] ?: return@runOnMain
            val merged = current.rawOptions.toMutableMap()
            merged["progress"] = progress.coerceIn(0.0, 1.0)
            overlay.show(LoaderItem(merged))
        }
    }

    @JvmStatic
    @JvmOverloads
    fun hide(id: String? = null, animated: Boolean = true, restoreWebView: Boolean = true) {
        runOnMain {
            val overlay = overlay ?: return@runOnMain
            val targetId = id ?: overlay.items.keys.lastOrNull() ?: return@runOnMain
            timers.remove(targetId)?.let { mainHandler.removeCallbacks(it) }
            overlay.hide(targetId, animated) {
                if (overlay.items.isEmpty() && restoreWebView && restoreWebViewOnHide) {
                    resetWebViewLayout(animated)
                }
            }
        }
    }

    @JvmStatic
    @JvmOverloads
    fun hideAll(animated: Boolean = true, restoreWebView: Boolean = true) {
        runOnMain {
            timers.values.forEach { mainHandler.removeCallbacks(it) }
            timers.clear()
            overlay?.hideAll(animated) {
                if (restoreWebView && restoreWebViewOnHide) {
                    resetWebViewLayout(animated)
                }
            }
        }
    }

    @JvmStatic
    fun getState(): Pair<Boolean, List<String>> {
        val ids = overlay?.items?.keys?.toList().orEmpty()
        return Pair(ids.isNotEmpty(), ids)
    }

    @JvmStatic
    @JvmOverloads
    fun setWebViewLayout(options: Map<String, Any?>, webView: View? = null) {
        runOnMain {
            val target = webView ?: this.webView ?: return@runOnMain
            this.webView = target
            val mode = options["mode"] as? String ?: "none"
            if (mode == "none") return@runOnMain

            if (webViewSnapshot == null) {
                webViewSnapshot = WebViewSnapshot(target)
            }

            val apply = {
                when (mode) {
                    "resize" -> applyResize(target, options)
                    "inset" -> applyInset(target, options)
                }
            }

            if (bool(options["animated"]) != false) {
                target.animate().setDuration(180).withStartAction { apply() }.start()
            } else {
                apply()
            }
        }
    }

    @JvmStatic
    @JvmOverloads
    fun resetWebViewLayout(animated: Boolean = true) {
        runOnMain {
            val target = webView ?: return@runOnMain
            val snapshot = webViewSnapshot ?: return@runOnMain
            val apply = {
                snapshot.restore(target)
                webViewSnapshot = null
            }
            if (animated) {
                target.animate().setDuration(180).withStartAction { apply() }.start()
            } else {
                apply()
            }
        }
    }

    private fun ensureOverlay(activity: Activity): NativeLoaderOverlay {
        if (overlay == null || overlayActivity !== activity) {
            overlay?.destroy()
            overlayActivity = activity
            overlay = NativeLoaderOverlay(activity)
        }
        return overlay!!
    }

    private fun scheduleAutoHide(item: LoaderItem) {
        timers.remove(item.id)?.let { mainHandler.removeCallbacks(it) }
        val autoHide = item.autoHide ?: return
        if (autoHide <= 0) return

        val runnable = Runnable { hide(item.id) }
        timers[item.id] = runnable
        mainHandler.postDelayed(runnable, autoHide.toLong())
    }

    private fun applyResize(target: View, options: Map<String, Any?>) {
        val params = target.layoutParams
        val frame = (options["frame"] as? Map<*, *>)?.toStringMap()
        if (frame != null) {
            params.width = number(frame["width"])?.toPx(target.context) ?: params.width
            params.height = number(frame["height"])?.toPx(target.context) ?: params.height
            if (params is ViewGroup.MarginLayoutParams) {
                params.leftMargin = number(frame["x"])?.toPx(target.context) ?: params.leftMargin
                params.topMargin = number(frame["y"])?.toPx(target.context) ?: params.topMargin
            }
        } else if (params is ViewGroup.MarginLayoutParams) {
            val insets = Insets.from((options["insets"] as? Map<*, *>)?.toStringMap(), target.context)
            params.setMargins(insets.left, insets.top, insets.right, insets.bottom)
        }
        target.layoutParams = params
        target.requestLayout()
    }

    private fun applyInset(target: View, options: Map<String, Any?>) {
        val insets = Insets.from((options["insets"] as? Map<*, *>)?.toStringMap(), target.context)
        target.setPadding(insets.left, insets.top, insets.right, insets.bottom)
        if (target is WebView) {
            target.clipToPadding = false
        }
    }

    private fun runOnMain(work: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            work()
        } else {
            mainHandler.post(work)
        }
    }
}

class NativeLoaderOverlay(private val activity: Activity) {
    val root = LoaderOverlayLayout(activity)
    val items = linkedMapOf<String, LoaderItem>()
    private val views = mutableMapOf<String, View>()

    init {
        root.layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        (activity.window.decorView as? ViewGroup)?.addView(root)
    }

    fun show(item: LoaderItem) {
        hide(item.id, animated = false)
        items[item.id] = item
        val view = buildItemView(item)
        views[item.id] = view
        root.addView(view)
        updateTouchMode()
    }

    fun hide(id: String, animated: Boolean, after: () -> Unit = {}) {
        val view = views[id]
        items.remove(id)
        views.remove(id)
        if (view == null) {
            updateTouchMode()
            after()
            return
        }

        val remove = {
            root.removeView(view)
            updateTouchMode()
            after()
        }

        if (animated) {
            view.animate().alpha(0f).scaleX(0.98f).scaleY(0.98f).setDuration(180).withEndAction { remove() }.start()
        } else {
            remove()
        }
    }

    fun hideAll(animated: Boolean, after: () -> Unit = {}) {
        val ids = items.keys.toList()
        if (ids.isEmpty()) {
            after()
            return
        }
        var remaining = ids.size
        ids.forEach { id ->
            hide(id, animated) {
                remaining -= 1
                if (remaining == 0) after()
            }
        }
    }

    fun destroy() {
        root.removeAllViews()
        (root.parent as? ViewGroup)?.removeView(root)
        items.clear()
        views.clear()
    }

    private fun updateTouchMode() {
        root.blocksTouches = items.values.any { it.interactionMode == "block" }
        root.loaderOnlyTouches = items.values.any { it.interactionMode == "loaderOnly" }
        root.hitViews = views.values.flatMap { collectHitViews(it) }
    }

    private fun collectHitViews(view: View): List<View> {
        val tag = view.getTag(R.id.native_loader_hit_view)
        if (tag == true) return listOf(view)
        if (view is ViewGroup) {
            return (0 until view.childCount).flatMap { collectHitViews(view.getChildAt(it)) }
        }
        return emptyList()
    }

    private fun buildItemView(item: LoaderItem): View {
        val container = FrameLayout(activity)
        container.layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        item.scrimColor?.let { container.setBackgroundColor(it) }

        if (item.placement == "around") {
            val around = AroundLoaderView(activity, item)
            around.setTag(R.id.native_loader_hit_view, true)
            container.addView(around, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            return container
        }

        if (item.style == "chrome") {
            val chrome = buildGraphic(item)
            chrome.setTag(R.id.native_loader_hit_view, true)
            val params = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                dp(max(item.thickness, 3.0)),
                Gravity.TOP,
            )
            params.topMargin = contentTopOffset()
            container.addView(chrome, params)
            return container
        }

        val card = LinearLayout(activity)
        card.orientation = LinearLayout.VERTICAL
        card.gravity = Gravity.CENTER
        card.setPadding(dp(18), dp(18), dp(18), dp(18))
        card.elevation = dp(14).toFloat()
        card.background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(item.cornerRadius).toFloat()
            setColor(item.backgroundColor ?: Color.argb(174, 10, 12, 18))
            setStroke(1, Color.argb(24, 255, 255, 255))
        }
        card.setTag(R.id.native_loader_hit_view, true)

        val graphic = buildGraphic(item)
        card.addView(graphic, LinearLayout.LayoutParams(dp(item.size), dp(item.size)))

        if (item.message.isNotBlank()) {
            val message = TextView(activity)
            message.text = item.message
            message.setTextColor(Color.WHITE)
            message.textSize = 14f
            message.gravity = Gravity.CENTER
            message.typeface = android.graphics.Typeface.DEFAULT_BOLD
            val params = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
            params.topMargin = dp(12)
            card.addView(message, params)
        }

        val params = FrameLayout.LayoutParams(
            item.frame?.width?.toPx(activity) ?: FrameLayout.LayoutParams.WRAP_CONTENT,
            item.frame?.height?.toPx(activity) ?: FrameLayout.LayoutParams.WRAP_CONTENT,
            gravityFor(item.placement),
        )
        params.setMargins(dp(16), dp(16), dp(16), dp(16))
        item.frame?.let {
            params.leftMargin = it.x.toPx(activity)
            params.topMargin = it.y.toPx(activity)
            params.gravity = Gravity.TOP or Gravity.LEFT
        }
        container.addView(card, params)
        return container
    }

    private fun buildGraphic(item: LoaderItem): View {
        if (item.style == "lottie" && item.asset != null) {
            return LottieAnimationView(activity).apply {
                setBackgroundColor(Color.TRANSPARENT)
                repeatCount = if (item.asset.loop) LottieDrawable.INFINITE else 0
                speed = item.asset.speed.toFloat()
                scaleType = ImageView.ScaleType.FIT_CENTER
                addLottieOnCompositionLoadedListener {
                    if (item.asset.autoPlay) playAnimation()
                }
                loadLottie(item.asset, this)
                if (item.asset.autoPlay) playAnimation()
            }
        }

        if (item.style == "image" && item.asset != null) {
            return AppCompatImageView(activity).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                loadImage(item.asset.source, this)
                if (item.progress != null) {
                    rotation = (item.progress * 360).toFloat()
                } else if (item.asset.autoPlay && !nativeLoaderShouldPauseMotion(activity, item)) {
                    val cycleDuration = max(120.0, item.duration / max(0.1, item.asset.speed)).toLong()
                    val animator = ObjectAnimator.ofFloat(this, View.ROTATION, 0f, 360f).apply {
                        duration = cycleDuration
                        repeatCount = if (item.asset.loop) ValueAnimator.INFINITE else 0
                        interpolator = LinearInterpolator()
                    }
                    addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
                        override fun onViewAttachedToWindow(view: View) {
                            animator.start()
                        }

                        override fun onViewDetachedFromWindow(view: View) {
                            animator.cancel()
                        }
                    })
                    if (isAttachedToWindow) animator.start()
                }
            }
        }

        return NativeLoaderGraphicView(activity, item)
    }

    private fun loadLottie(asset: LoaderAsset, view: LottieAnimationView) {
        val source = asset.source
        when {
            source.startsWith("data:") -> dataFromDataUrl(source)?.toString(Charsets.UTF_8)?.let {
                view.setAnimationFromJson(it, "native-loader-${UUID.randomUUID()}")
            }
            source.trimStart().startsWith("{") -> view.setAnimationFromJson(source, "native-loader-${UUID.randomUUID()}")
            source.startsWith("http://") || source.startsWith("https://") -> view.setAnimationFromUrl(source)
            source.startsWith("file://") -> view.setAnimationFromJson(File(URL(source).path).readText(), source)
            File(source).exists() -> view.setAnimationFromJson(File(source).readText(), source)
            else -> view.setAnimation(source)
        }
    }

    private fun loadImage(source: String, imageView: AppCompatImageView) {
        when {
            source.startsWith("data:") -> dataFromDataUrl(source)?.let {
                imageView.setImageBitmap(BitmapFactory.decodeByteArray(it, 0, it.size))
            }
            source.startsWith("file://") -> imageView.setImageBitmap(BitmapFactory.decodeFile(URL(source).path))
            File(source).exists() -> imageView.setImageBitmap(BitmapFactory.decodeFile(source))
            source.startsWith("http://") || source.startsWith("https://") -> Thread {
                val bitmap = URL(source).openStream().use { BitmapFactory.decodeStream(it) }
                imageView.post { imageView.setImageBitmap(bitmap) }
            }.start()
            else -> {
                val id = activity.resources.getIdentifier(source.substringBeforeLast("."), "drawable", activity.packageName)
                if (id != 0) imageView.setImageResource(id)
            }
        }
    }

    private fun gravityFor(placement: String): Int = when (placement) {
        "top" -> Gravity.TOP or Gravity.CENTER_HORIZONTAL
        "bottom" -> Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        "left" -> Gravity.LEFT or Gravity.CENTER_VERTICAL
        "right" -> Gravity.RIGHT or Gravity.CENTER_VERTICAL
        else -> Gravity.CENTER
    }

    private fun dp(value: Number): Int = value.toDouble().toPx(activity)

    private fun contentTopOffset(): Int {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return activity.window.decorView.rootWindowInsets
                ?.getInsets(WindowInsets.Type.statusBars())
                ?.top
                ?: 0
        }
        val id = activity.resources.getIdentifier("status_bar_height", "dimen", "android")
        return if (id > 0) activity.resources.getDimensionPixelSize(id) else 0
    }

}

class LoaderOverlayLayout(context: Context) : FrameLayout(context) {
    var blocksTouches = false
    var loaderOnlyTouches = false
    var hitViews: List<View> = emptyList()

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (blocksTouches) return true
        if (loaderOnlyTouches && hitViews.any { event.isInside(it) }) {
            return super.dispatchTouchEvent(event)
        }
        return false
    }
}

class NativeLoaderGraphicView(context: Context, private val item: LoaderItem) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val startTime = System.currentTimeMillis()
    private val tick = object : Runnable {
        override fun run() {
            invalidate()
            postOnAnimation(this)
        }
    }

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!shouldPauseMotion()) {
            postOnAnimation(tick)
        }
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val time = animationTime()
        when (item.style) {
            "chrome" -> drawChrome(canvas, time)
            "orbit" -> drawOrbit(canvas, time)
            "ring" -> drawRing(canvas, time)
            "pulse" -> drawPulse(canvas, time)
            "dots" -> drawDots(canvas, time)
            "bars" -> drawBars(canvas, time)
            "wave" -> drawWave(canvas, time)
            "halo" -> drawHalo(canvas, time)
            else -> drawSiri(canvas, time)
        }
    }

    private fun drawChrome(canvas: Canvas, time: Double) {
        val thickness = max(2f, min(height.toFloat(), item.thicknessPx(context)))
        val top = (height - thickness) / 2f
        val track = RectF(0f, top, width.toFloat(), top + thickness)
        paint.maskFilter = null
        paint.shader = null
        paint.color = withAlpha(item.colors[0], 46)
        canvas.drawRoundRect(track, thickness / 2f, thickness / 2f, paint)

        val progress = item.progress
        val segmentWidth = if (progress != null) {
            width * progress.toFloat()
        } else {
            max(width * 0.42f, thickness * 12f)
        }
        if (segmentWidth <= 0f) return

        val left = if (progress != null) {
            0f
        } else {
            val phase = (time % 1.0).toFloat()
            -segmentWidth + (width + segmentWidth * 2f) * phase
        }
        val bar = RectF(left, top, left + segmentWidth, top + thickness)
        paint.maskFilter = BlurMaskFilter(thickness * 1.5f, BlurMaskFilter.Blur.NORMAL)
        paint.shader = null
        paint.color = withAlpha(item.colors[1], 70)
        canvas.drawRoundRect(
            RectF(bar.left - thickness * 2f, bar.top - thickness, bar.right + thickness * 2f, bar.bottom + thickness),
            thickness,
            thickness,
            paint,
        )
        paint.maskFilter = null
        paint.shader = LinearGradient(left, top, left + segmentWidth, top, item.colors, null, Shader.TileMode.CLAMP)
        canvas.drawRoundRect(bar, thickness / 2f, thickness / 2f, paint)
        paint.shader = null
    }

    private fun drawSiri(canvas: Canvas, time: Double) {
        val radius = min(width, height) * 0.28f
        val centerX = width / 2f
        val centerY = height / 2f
        paint.maskFilter = BlurMaskFilter(width * 0.045f, BlurMaskFilter.Blur.NORMAL)
        repeat(4) { index ->
            val angle = time * 1.8 + index * PI / 2
            val scale = 0.76f + 0.2f * sin(angle + index).toFloat()
            paint.color = item.colors[index % item.colors.size]
            paint.alpha = 180
            canvas.drawCircle(
                centerX + cos(angle).toFloat() * width * 0.1f,
                centerY + sin(angle * 1.1).toFloat() * height * 0.1f,
                radius * scale,
                paint,
            )
        }
        paint.maskFilter = null
        strokePaint.strokeWidth = item.thicknessPx(context)
        strokePaint.color = Color.argb(44, 255, 255, 255)
        canvas.drawCircle(centerX, centerY, min(width, height) * 0.36f, strokePaint)
    }

    private fun drawOrbit(canvas: Canvas, time: Double) {
        val centerX = width / 2f
        val centerY = height / 2f
        val orbit = min(width, height) * 0.35f
        strokePaint.strokeWidth = item.thicknessPx(context)
        strokePaint.color = withAlpha(item.colors[0], 42)
        canvas.drawCircle(centerX, centerY, orbit, strokePaint)
        paint.maskFilter = null
        repeat(6) { index ->
            val angle = time * 2.4 + index * PI / 3
            paint.color = item.colors[index % item.colors.size]
            paint.alpha = (90 + 165 * (index + 1) / 6)
            canvas.drawCircle(centerX + cos(angle).toFloat() * orbit, centerY + sin(angle).toFloat() * orbit, width * 0.055f, paint)
        }
    }

    private fun drawRing(canvas: Canvas, time: Double) {
        val inset = item.thicknessPx(context)
        val rect = RectF(inset, inset, width - inset, height - inset)
        strokePaint.strokeWidth = item.thicknessPx(context)
        strokePaint.color = withAlpha(item.colors[0], 36)
        canvas.drawOval(rect, strokePaint)
        strokePaint.shader = SweepGradient(width / 2f, height / 2f, item.colors, null)
        val sweep = ((item.progress ?: 0.72) * 360).toFloat()
        val start = if (item.progress == null) (time * 180).toFloat() else -90f
        canvas.drawArc(rect, start, sweep, false, strokePaint)
        strokePaint.shader = null
    }

    private fun drawPulse(canvas: Canvas, time: Double) {
        strokePaint.strokeWidth = item.thicknessPx(context)
        val centerX = width / 2f
        val centerY = height / 2f
        repeat(4) { index ->
            val phase = ((time / 1.35 + index * 0.18) % 1).toFloat()
            strokePaint.color = withAlpha(item.colors[index % item.colors.size], ((1 - phase) * 255).toInt())
            canvas.drawCircle(centerX, centerY, width * (0.09f + phase * 0.46f), strokePaint)
        }
    }

    private fun drawDots(canvas: Canvas, time: Double) {
        val radius = width * 0.085f
        val gap = width * 0.14f
        val start = width / 2f - gap
        repeat(3) { index ->
            val signal = sin(time * 4 + index * 0.8).toFloat()
            paint.color = item.colors[index % item.colors.size]
            paint.alpha = (140 + 115 * ((signal + 1) / 2)).toInt()
            canvas.drawCircle(start + index * gap, height / 2f + signal * height * 0.12f, radius, paint)
        }
    }

    private fun drawBars(canvas: Canvas, time: Double) {
        val barWidth = width * 0.09f
        val gap = width * 0.06f
        val total = barWidth * 5 + gap * 4
        var left = width / 2f - total / 2f
        repeat(5) { index ->
            val scale = 0.35f + 0.65f * ((sin(time * 4.2 + index * 0.72) + 1) / 2).toFloat()
            paint.color = item.colors[index % item.colors.size]
            paint.alpha = 235
            val barHeight = height * 0.62f * scale
            canvas.drawRoundRect(RectF(left, height / 2f - barHeight / 2f, left + barWidth, height / 2f + barHeight / 2f), barWidth, barWidth, paint)
            left += barWidth + gap
        }
    }

    private fun drawWave(canvas: Canvas, time: Double) {
        strokePaint.strokeWidth = item.thicknessPx(context)
        strokePaint.shader = SweepGradient(width / 2f, height / 2f, item.colors, null)
        val path = android.graphics.Path()
        val midY = height / 2f
        var x = 0f
        while (x <= width) {
            val progress = x / width
            val y = midY + sin(progress * PI * 2 + time * 3.2).toFloat() * height * 0.18f
            if (x == 0f) path.moveTo(x, y) else path.lineTo(x, y)
            x += 2f
        }
        canvas.drawPath(path, strokePaint)
        strokePaint.shader = null
    }

    private fun drawHalo(canvas: Canvas, time: Double) {
        val centerX = width / 2f
        val centerY = height / 2f
        paint.shader = SweepGradient(centerX, centerY, item.colors, null)
        paint.maskFilter = BlurMaskFilter(width * 0.08f, BlurMaskFilter.Blur.NORMAL)
        canvas.save()
        canvas.rotate((time * 120).toFloat(), centerX, centerY)
        canvas.drawCircle(centerX, centerY, width * 0.38f, paint)
        canvas.restore()
        paint.shader = null
        paint.maskFilter = null
        paint.color = Color.argb(118, 0, 0, 0)
        canvas.drawCircle(centerX, centerY, width * 0.28f, paint)
    }

    private fun animationTime(): Double {
        if (shouldPauseMotion()) return 0.0
        val scale = if (shouldSlowMotion()) 0.35 else 1.0
        return ((System.currentTimeMillis() - startTime).toDouble() / item.duration) * item.speed * scale
    }

    private fun shouldPauseMotion(): Boolean {
        val animatorsEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ValueAnimator.areAnimatorsEnabled()
        } else {
            Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
        }
        return item.reducedMotion == "pause" || (item.reducedMotion == "system" && !animatorsEnabled)
    }

    private fun shouldSlowMotion(): Boolean {
        if (item.reducedMotion == "slow") return true
        if (item.reducedMotion != "system") return false
        val durationScale = Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f)
        return durationScale > 1f
    }
}

class AroundLoaderView(context: Context, private val item: LoaderItem) : View(context) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val startTime = System.currentTimeMillis()
    private val tick = object : Runnable {
        override fun run() {
            invalidate()
            postOnAnimation(this)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        postOnAnimation(tick)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(tick)
        super.onDetachedFromWindow()
    }

    override fun onDraw(canvas: Canvas) {
        val thickness = item.thicknessPx(context)
        val rect = RectF(thickness, thickness, width - thickness, height - thickness)
        paint.strokeWidth = thickness
        paint.color = withAlpha(Color.WHITE, 24)
        canvas.drawRect(rect, paint)
        paint.shader = SweepGradient(width / 2f, height / 2f, item.colors, null)
        canvas.save()
        canvas.rotate((((System.currentTimeMillis() - startTime).toDouble() / item.duration) * item.speed * 140).toFloat(), width / 2f, height / 2f)
        canvas.drawArc(rect, -90f, 130f, false, paint)
        canvas.restore()
        paint.shader = null
    }
}

data class LoaderItem(val rawOptions: Map<String, Any?>) {
    val id: String = rawOptions["id"] as? String ?: "loader-${UUID.randomUUID()}"
    val style: String = rawOptions["style"] as? String ?: "siri"
    val placement: String = rawOptions["placement"] as? String ?: "center"
    val interactionMode: String = rawOptions["interactionMode"] as? String ?: if (rawOptions["scrimColor"] == null) "passThrough" else "block"
    val reducedMotion: String = rawOptions["reducedMotion"] as? String ?: "system"
    val message: String = rawOptions["message"] as? String ?: ""
    val size: Double = number(rawOptions["size"]) ?: 96.0
    val thickness: Double = number(rawOptions["thickness"]) ?: 5.0
    val duration: Double = number(rawOptions["duration"]) ?: defaultDuration(style)
    val speed: Double = max(0.1, number(rawOptions["speed"]) ?: 1.0)
    val progress: Double? = number(rawOptions["progress"])?.coerceIn(0.0, 1.0)
    val colors: IntArray = parseColors(rawOptions["colors"] as? List<*>)
    val backgroundColor: Int? = parseColor(rawOptions["backgroundColor"])
    val scrimColor: Int? = parseColor(rawOptions["scrimColor"])
    val cornerRadius: Double = number(rawOptions["cornerRadius"]) ?: 24.0
    val autoHide: Double? = number(rawOptions["autoHide"])
    val accessibilityLabel: String? = rawOptions["accessibilityLabel"] as? String
    val frame: LoaderFrame? = (rawOptions["frame"] as? Map<*, *>)?.toStringMap()?.let { LoaderFrame.from(it) }
    val asset: LoaderAsset? = (rawOptions["asset"] as? Map<*, *>)?.toStringMap()?.let { LoaderAsset.from(it, if (style == "image") "image" else "lottie") }

    fun thicknessPx(context: Context): Float = thickness.toPx(context).toFloat()
}

data class LoaderAsset(
    val source: String,
    val type: String,
    val loop: Boolean,
    val speed: Double,
    val autoPlay: Boolean,
) {
    companion object {
        fun from(options: Map<String, Any?>, fallbackType: String): LoaderAsset? {
            val source = options["source"] as? String ?: return null
            return LoaderAsset(
                source = source,
                type = options["type"] as? String ?: fallbackType,
                loop = bool(options["loop"]) ?: true,
                speed = number(options["speed"]) ?: 1.0,
                autoPlay = bool(options["autoPlay"]) ?: true,
            )
        }
    }
}

data class LoaderFrame(val x: Double, val y: Double, val width: Double, val height: Double) {
    companion object {
        fun from(options: Map<String, Any?>): LoaderFrame? {
            return LoaderFrame(
                x = number(options["x"]) ?: return null,
                y = number(options["y"]) ?: return null,
                width = number(options["width"]) ?: return null,
                height = number(options["height"]) ?: return null,
            )
        }
    }
}

data class Insets(val top: Int, val right: Int, val bottom: Int, val left: Int) {
    companion object {
        fun from(options: Map<String, Any?>?, context: Context): Insets {
            return Insets(
                top = number(options?.get("top"))?.toPx(context) ?: 0,
                right = number(options?.get("right"))?.toPx(context) ?: 0,
                bottom = number(options?.get("bottom"))?.toPx(context) ?: 0,
                left = number(options?.get("left"))?.toPx(context) ?: 0,
            )
        }
    }
}

data class WebViewSnapshot(
    val width: Int,
    val height: Int,
    val leftMargin: Int,
    val topMargin: Int,
    val rightMargin: Int,
    val bottomMargin: Int,
    val paddingLeft: Int,
    val paddingTop: Int,
    val paddingRight: Int,
    val paddingBottom: Int,
) {
    constructor(view: View) : this(
        width = view.layoutParams.width,
        height = view.layoutParams.height,
        leftMargin = (view.layoutParams as? ViewGroup.MarginLayoutParams)?.leftMargin ?: 0,
        topMargin = (view.layoutParams as? ViewGroup.MarginLayoutParams)?.topMargin ?: 0,
        rightMargin = (view.layoutParams as? ViewGroup.MarginLayoutParams)?.rightMargin ?: 0,
        bottomMargin = (view.layoutParams as? ViewGroup.MarginLayoutParams)?.bottomMargin ?: 0,
        paddingLeft = view.paddingLeft,
        paddingTop = view.paddingTop,
        paddingRight = view.paddingRight,
        paddingBottom = view.paddingBottom,
    )

    fun restore(view: View) {
        val params = view.layoutParams
        params.width = width
        params.height = height
        if (params is ViewGroup.MarginLayoutParams) {
            params.setMargins(leftMargin, topMargin, rightMargin, bottomMargin)
        }
        view.layoutParams = params
        view.setPadding(paddingLeft, paddingTop, paddingRight, paddingBottom)
        view.requestLayout()
    }
}

fun Map<*, *>.toStringMap(): Map<String, Any?> = entries.associate { it.key.toString() to it.value }

private fun parseColors(values: List<*>?): IntArray {
    val parsed = values?.mapNotNull { parseColor(it) }.orEmpty()
    return if (parsed.isNotEmpty()) {
        parsed.toIntArray()
    } else {
        intArrayOf(
            Color.rgb(113, 246, 255),
            Color.rgb(139, 92, 246),
            Color.rgb(255, 78, 205),
            Color.rgb(255, 247, 173),
        )
    }
}

private fun parseColor(value: Any?): Int? {
    val color = value as? String ?: return null
    return try {
        when {
            color.startsWith("rgba(", ignoreCase = true) -> parseRgba(color)
            color.startsWith("rgb(", ignoreCase = true) -> parseRgb(color)
            else -> Color.parseColor(color)
        }
    } catch (_: IllegalArgumentException) {
        null
    }
}

private fun parseRgb(value: String): Int {
    val parts = value.substringAfter("(").substringBeforeLast(")").split(",").map { it.trim().toInt() }
    return Color.rgb(parts[0], parts[1], parts[2])
}

private fun parseRgba(value: String): Int {
    val parts = value.substringAfter("(").substringBeforeLast(")").split(",").map { it.trim() }
    return Color.argb((parts[3].toFloat() * 255).toInt().coerceIn(0, 255), parts[0].toInt(), parts[1].toInt(), parts[2].toInt())
}

private fun defaultDuration(style: String): Double = when (style) {
    "siri" -> 1500.0
    "chrome" -> 1200.0
    "pulse" -> 1350.0
    "dots", "bars" -> 780.0
    else -> 1100.0
}

private fun nativeLoaderShouldPauseMotion(context: Context, item: LoaderItem): Boolean {
    val animatorsEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ValueAnimator.areAnimatorsEnabled()
    } else {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
    }
    return item.reducedMotion == "pause" || (item.reducedMotion == "system" && !animatorsEnabled)
}

private fun number(value: Any?): Double? {
    return when (value) {
        is Number -> value.toDouble()
        is String -> value.toDoubleOrNull()
        else -> null
    }
}

private fun bool(value: Any?): Boolean? {
    return when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        is String -> value.equals("true", ignoreCase = true)
        else -> null
    }
}

private fun Number.toPx(context: Context): Int = (toDouble() * context.resources.displayMetrics.density).toInt()

private fun withAlpha(color: Int, alpha: Int): Int = Color.argb(alpha.coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))

private fun dataFromDataUrl(source: String): ByteArray? {
    val payload = source.substringAfter(",", "")
    if (payload.isEmpty()) return null
    return try {
        if (source.substringBefore(",", "").contains(";base64", ignoreCase = true)) {
            Base64.decode(payload, Base64.DEFAULT)
        } else {
            URLDecoder.decode(payload, Charsets.UTF_8.name()).toByteArray(Charsets.UTF_8)
        }
    } catch (_: IllegalArgumentException) {
        null
    }
}

private fun MotionEvent.isInside(view: View): Boolean {
    val location = IntArray(2)
    view.getLocationOnScreen(location)
    val x = rawX.toInt()
    val y = rawY.toInt()
    return x >= location[0] && x <= location[0] + view.width && y >= location[1] && y <= location[1] + view.height
}
