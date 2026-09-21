package io.clayson.quicktodo;

import android.content.res.Configuration;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    // Must match --bg in src/styles.css and res/values{,-night}/colors.xml.
    private static final int BG_LIGHT = 0xFFF6F7F9;
    private static final int BG_DARK = 0xFF111418;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Paint the WebView in the page's own background colour so the frames
        // between WebView creation and the first web paint are not white.
        int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        getBridge().getWebView().setBackgroundColor(night == Configuration.UI_MODE_NIGHT_YES ? BG_DARK : BG_LIGHT);
    }
}
