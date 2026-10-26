package dev.apkweb.feature

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private data class RequestItem(val id: Int, val title: String, val category: String, val urgent: Boolean, val done: Boolean)
private fun initialItems() = listOf(
    RequestItem(1, "Acesso ao ambiente", "Acesso", false, false),
    RequestItem(2, "Compra de equipamento", "Compras", true, false),
    RequestItem(3, "Revisão de contrato", "Jurídico", false, true)
)
private val ItemSaver = listSaver<List<RequestItem>, String>(
    save = { rows -> rows.flatMap { listOf(it.id.toString(), it.title, it.category, it.urgent.toString(), it.done.toString()) } },
    restore = { values -> values.chunked(5).map { RequestItem(it[0].toInt(), it[1], it[2], it[3].toBoolean(), it[4].toBoolean()) } }
)

/** Identical Material3 composition compiled for Android and browser Wasm. */
@Composable
fun RequestFeature(onStateChanged: (Int, String) -> Unit = { _, _ -> }) {
    var requests by rememberSaveable(stateSaver = ItemSaver) { mutableStateOf(initialItems()) }
    var count by rememberSaveable { mutableStateOf(0) }
    var request by rememberSaveable { mutableStateOf("Acesso ao ambiente") }
    var urgent by rememberSaveable { mutableStateOf(false) }
    var category by rememberSaveable { mutableStateOf("Acesso") }
    var query by rememberSaveable { mutableStateOf("") }
    var filter by rememberSaveable { mutableStateOf("Todas") }
    var showForm by rememberSaveable { mutableStateOf(false) }
    var showReset by rememberSaveable { mutableStateOf(false) }
    var detailId by rememberSaveable { mutableStateOf<Int?>(null) }
    var attempted by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(count, request) { onStateChanged(count, request) }
    val visible = requests.filter { it.title.contains(query, true) && (filter == "Todas" || (filter == "Concluídas") == it.done) }
    val progress = if (requests.isEmpty()) 0f else requests.count { it.done }.toFloat() / requests.size
    fun addItem() {
        attempted = true
        if (request.trim().length >= 3) {
            requests = requests + RequestItem((requests.maxOfOrNull { it.id } ?: 0) + 1, request.trim(), category, urgent, false)
            count++; showForm = false; attempted = false
        }
    }
    MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF315CE8), onPrimary = Color.White,
        surface = Color.White, background = Color(0xFFF5F7FC))) {
        BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
            val wide = maxWidth >= 760.dp
            LazyColumn(Modifier.fillMaxSize().testTag("compose-dashboard"), contentPadding = PaddingValues(if (wide) 28.dp else 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)) {
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text("CENTRAL INTERNA", color = MaterialTheme.colorScheme.primary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            Text("Painel de solicitações", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                        }
                        TextButton(onClick = { showReset = true }) { Text("Zerar") }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Stat("Total", requests.size, Modifier.weight(1f))
                        Stat("Pendentes", requests.count { !it.done }, Modifier.weight(1f))
                        Stat("Adicionadas", count, Modifier.weight(1f))
                    }
                    Text("Conclusão · ${(progress * 100).toInt()}%", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelMedium)
                    LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().height(7.dp))
                }
                item {
                    OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth().testTag("compose-search"),
                        label = { Text("Buscar solicitação") }, singleLine = true)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("Todas", "Pendentes", "Concluídas").forEach { option ->
                            FilterChip(filter == option, { filter = option }, label = { Text(option) }, modifier = Modifier.testTag("compose-filter-$option"))
                        }
                    }
                }
                if (!wide) item { Button({ showForm = true }, Modifier.fillMaxWidth()) { Text("Nova solicitação") } }
                item { Text("${visible.size} resultados", style = MaterialTheme.typography.titleSmall) }
                if (wide) item {
                    Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        Column(Modifier.weight(1.2f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            visible.forEach { row -> RequestCard(row, { detailId = row.id }, {
                                requests = requests.map { if (it.id == row.id) it.copy(done = !it.done) else it }
                            }) }
                        }
                        OutlinedCard(Modifier.weight(1f)) {
                            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Text("Nova solicitação", style = MaterialTheme.typography.titleLarge)
                                RequestForm(request, { request = it }, urgent, { urgent = it }, category, { category = it }, attempted)
                                Button({ addItem() }, Modifier.fillMaxWidth()) { Text("Adicionar item") }
                            }
                        }
                    }
                } else items(visible, key = { it.id }) { row -> RequestCard(row, { detailId = row.id }, {
                    requests = requests.map { if (it.id == row.id) it.copy(done = !it.done) else it }
                }) }
                if (visible.isEmpty()) item { Text("Nenhuma solicitação encontrada.") }
            }
            if (showForm && !wide) AlertDialog(onDismissRequest = { showForm = false }, title = { Text("Nova solicitação") },
                text = { RequestForm(request, { request = it }, urgent, { urgent = it }, category, { category = it }, attempted) },
                confirmButton = { TextButton({ addItem() }) { Text("Adicionar item") } },
                dismissButton = { TextButton({ showForm = false }) { Text("Cancelar") } })
            if (showReset) AlertDialog(onDismissRequest = { showReset = false }, title = { Text("Restaurar painel?") },
                text = { Text("Os pedidos de demonstração voltarão ao estado inicial.") }, confirmButton = { TextButton({
                    requests = initialItems(); count = 0; request = "Acesso ao ambiente"; query = ""; filter = "Todas"
                    urgent = false; category = "Acesso"; showReset = false
                }) { Text("Restaurar") } }, dismissButton = { TextButton({ showReset = false }) { Text("Cancelar") } })
            requests.find { it.id == detailId }?.let { row ->
                AlertDialog(onDismissRequest = { detailId = null }, title = { Text(row.title) },
                    text = { Text("${row.category} · ${if (row.done) "Concluída" else "Pendente"}${if (row.urgent) " · Urgente" else ""}") },
                    confirmButton = { TextButton({ detailId = null }) { Text("Fechar") } })
            }
        }
    }
}

@Composable private fun Stat(label: String, value: Int, modifier: Modifier) {
    Surface(modifier, shape = RoundedCornerShape(14.dp), color = Color.White) {
        Column(Modifier.padding(14.dp)) {
            Text(label, style = MaterialTheme.typography.labelMedium, color = Color(0xFF667085))
            Text(value.toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        }
    }
}
@Composable private fun RequestForm(title: String, onTitle: (String) -> Unit, urgent: Boolean, onUrgent: (Boolean) -> Unit,
    category: String, onCategory: (String) -> Unit, attempted: Boolean) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(title, onTitle, Modifier.fillMaxWidth().testTag("compose-title"), label = { Text("Nome da solicitação") },
            singleLine = true, isError = attempted && title.trim().length < 3)
        if (attempted && title.trim().length < 3) Text("Informe pelo menos 3 caracteres.", color = MaterialTheme.colorScheme.error)
        Text("Categoria", style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("Acesso", "Compras", "Jurídico").forEach { option ->
                FilterChip(category == option, { onCategory(option) }, label = { Text(option) }, modifier = Modifier.testTag("compose-category-$option"))
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Urgente", Modifier.padding(top = 12.dp))
            Switch(urgent, onUrgent, Modifier.testTag("compose-urgent"))
        }
    }
}
@Composable private fun RequestCard(row: RequestItem, onDetails: () -> Unit, onDone: () -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth().testTag("compose-request-${row.id}")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(row.category, style = MaterialTheme.typography.labelMedium, color = Color(0xFF667085))
                if (row.urgent) Text("URGENTE", style = MaterialTheme.typography.labelSmall, color = Color(0xFFB54708))
            }
            Text(row.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(if (row.done) "Concluída" else "Pendente", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onDetails) { Text("Detalhes") }; TextButton(onDone) { Text(if (row.done) "Reabrir" else "Concluir") }
            }
        }
    }
}
