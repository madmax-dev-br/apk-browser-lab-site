package dev.apkweb.dashboard;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.Switch;
import android.widget.TextView;

public class MainActivity extends Activity implements View.OnClickListener, CompoundButton.OnCheckedChangeListener, TextWatcher {
    public int count;
    private String savedTitle = "";
    private boolean savedUrgent;
    private EditText search;
    private EditText draft;
    private CheckBox urgent;
    private Switch onlyPending;
    private TextView status;
    private ProgressBar completion;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);
        search = (EditText) findViewById(R.id.search);
        draft = (EditText) findViewById(R.id.draft_title);
        urgent = (CheckBox) findViewById(R.id.urgent);
        onlyPending = (Switch) findViewById(R.id.only_pending);
        status = (TextView) findViewById(R.id.form_status);
        completion = (ProgressBar) findViewById(R.id.completion);
        findViewById(R.id.save).setOnClickListener(this);
        findViewById(R.id.open_access).setOnClickListener(this);
        findViewById(R.id.open_new).setOnClickListener(this);
        search.addTextChangedListener(this);
        urgent.setOnCheckedChangeListener(this);
        onlyPending.setOnCheckedChangeListener(this);
        refresh();
    }
    @Override public void onClick(View view) {
        if (view.getId() == R.id.save) {
            String title = draft.getText().toString();
            if (title.length() < 3) { status.setText("Informe pelo menos 3 caracteres."); return; }
            savedTitle = title;
            savedUrgent = urgent.isChecked();
            count = 1;
            ((TextView) findViewById(R.id.title_new)).setText(savedTitle);
            ((TextView) findViewById(R.id.status_new)).setText(savedUrgent ? "Pendente · Urgente" : "Pendente");
            status.setText("Solicitação salva.");
            refresh();
        } else {
            boolean custom = view.getId() == R.id.open_new;
            Intent detail = new Intent(this, DetailActivity.class);
            detail.putExtra("title", custom ? savedTitle : getString(R.string.seed_access));
            detail.putExtra("urgent", custom && savedUrgent);
            detail.putExtra("progress", completion.getProgress());
            startActivity(detail);
        }
    }
    private int show(int id, String title, boolean done, String query) {
        boolean visible = title.indexOf(query) >= 0 && (!onlyPending.isChecked() || !done);
        findViewById(id).setVisibility(visible ? View.VISIBLE : View.GONE);
        return visible ? 1 : 0;
    }
    private void refresh() {
        String query = search.getText().toString();
        int visible = show(R.id.card_access, getString(R.string.seed_access), false, query);
        visible += show(R.id.card_equipment, getString(R.string.seed_equipment), false, query);
        visible += show(R.id.card_contract, getString(R.string.seed_contract), true, query);
        if (count > 0) visible += show(R.id.card_new, savedTitle, false, query);
        else findViewById(R.id.card_new).setVisibility(View.GONE);
        ((TextView) findViewById(R.id.results)).setText(Integer.toString(visible) + " resultados");
        ((TextView) findViewById(R.id.metric_total)).setText(Integer.toString(3 + count));
        ((TextView) findViewById(R.id.metric_pending)).setText(Integer.toString(2 + count));
        ((TextView) findViewById(R.id.metric_added)).setText(Integer.toString(count));
        int progress = 100 / (3 + count);
        completion.setProgress(progress);
        ((TextView) findViewById(R.id.progress_label)).setText("Conclusão · " + Integer.toString(progress) + "%");
    }
    @Override public void onCheckedChanged(CompoundButton button, boolean checked) {
        if (button.getId() == R.id.urgent) status.setText(checked ? "Urgente selecionado." : "Prioridade normal.");
        refresh();
    }
    @Override public void onTextChanged(CharSequence text, int start, int before, int count) { refresh(); }
    @Override public void beforeTextChanged(CharSequence text, int start, int count, int after) { }
    @Override public void afterTextChanged(Editable text) { }
}
