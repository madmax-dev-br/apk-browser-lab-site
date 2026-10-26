package dev.apkweb.dashboard;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.TextView;
public class DetailActivity extends Activity implements View.OnClickListener {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); setContentView(R.layout.activity_detail);
        ((TextView) findViewById(R.id.detail_title)).setText(getIntent().getStringExtra("title"));
        ((TextView) findViewById(R.id.detail_status)).setText(getIntent().getBooleanExtra("urgent", false) ? "Pendente · Urgente" : "Pendente");
        ((ProgressBar) findViewById(R.id.detail_progress)).setProgress(getIntent().getIntExtra("progress", 0));
        findViewById(R.id.back).setOnClickListener(this);
    }
    @Override public void onClick(View view) { finish(); }
}
