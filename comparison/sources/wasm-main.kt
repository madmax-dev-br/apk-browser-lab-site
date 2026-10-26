@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)

import androidx.compose.ui.window.ComposeViewport
import dev.apkweb.feature.RequestFeature
import kotlinx.browser.document
import kotlin.js.js

private fun notifyHost(type: String, count: Int, request: String): Unit = js("{ if(type === 'compose-ready') document.getElementById('loading')?.remove(); window.parent.postMessage({type, count, request}, window.location.origin); }")

fun main() {
    var readySent = false
    ComposeViewport(document.body!!) {
        RequestFeature { count, request ->
            if (!readySent) {
                readySent = true
                notifyHost("compose-ready", count, request)
            }
            notifyHost("feature-state", count, request)
        }
    }
}
